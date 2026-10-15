//! Commandes de verrouillage, de coffre de clés, de Touch ID et de sauvegardes.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use zeroize::Zeroizing;

use crate::config::{self, AppPaths, AUTO_LOCK_CHOICES};
use crate::database::{self, Db, OpenError, Unlocked};
use crate::external_backup::{self, BackupEntry, Secret};
use crate::security::biometry::{self, BiometryOutcome};
use crate::security::vault::{KdfParams, MasterKey, Vault, VaultError};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LockState {
    SetupRequired,
    Locked,
    Unlocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub state: LockState,
    pub touch_id_available: bool,
    pub touch_id_enabled: bool,
    /// Données d'une version précédente, en clair, qui seront chiffrées à la création.
    pub has_plaintext_data: bool,
    /// Base chiffrée présente mais coffre absent : seule une restauration peut aider.
    pub vault_missing: bool,
    pub auto_lock_minutes: u32,
}

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn settings_error(error: Box<dyn std::error::Error>) -> String {
    eprintln!("réglages : {error}");
    "Les réglages n'ont pas pu être enregistrés.".to_string()
}

fn status(db: &Db, paths: &AppPaths) -> SecurityStatus {
    let settings = config::load_settings(paths).unwrap_or_default();
    let vault_exists = paths.vault.exists();
    let database_exists = paths.database.exists();
    let plaintext =
        database_exists && database::is_plaintext_sqlite(&paths.database).unwrap_or(false);
    let state = if !vault_exists {
        LockState::SetupRequired
    } else if db.is_unlocked() {
        LockState::Unlocked
    } else {
        LockState::Locked
    };
    SecurityStatus {
        state,
        touch_id_available: biometry::available(),
        touch_id_enabled: settings.security.touch_id && biometry::available(),
        has_plaintext_data: !vault_exists && plaintext,
        vault_missing: !vault_exists && database_exists && !plaintext,
        auto_lock_minutes: settings.security.auto_lock_minutes,
    }
}

#[tauri::command]
pub fn get_security_status(db: State<'_, Db>, paths: State<'_, AppPaths>) -> SecurityStatus {
    status(&db, &paths)
}

/// Dérivation Argon2 hors du fil asynchrone (environ une demi-seconde).
async fn derive<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, VaultError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "Opération interrompue.".to_string())?
        .map_err(|error| error.to_string())
}

static FAILED_ATTEMPTS: AtomicU32 = AtomicU32::new(0);

/// Après cinq erreurs d'affilée, chaque nouvel essai attend quelques secondes.
async fn slow_down_after_failures() {
    let failures = FAILED_ATTEMPTS.load(Ordering::Relaxed);
    if failures >= 5 {
        let seconds = u64::from((failures - 4).min(6)) * 5;
        tokio_sleep(seconds).await;
    }
}

async fn tokio_sleep(seconds: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_secs(seconds));
    })
    .await;
}

fn open_error(error: OpenError) -> String {
    error.to_string()
}

async fn open_with_key(
    app: &AppHandle,
    db: &Db,
    paths: &AppPaths,
    key: MasterKey,
) -> Result<SecurityStatus, OpenError> {
    let pool = database::open(paths, &key, &version(app)).await?;
    db.set(Unlocked { pool, key });
    FAILED_ATTEMPTS.store(0, Ordering::Relaxed);
    Ok(status(db, paths))
}

#[tauri::command]
pub async fn setup_security(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    password: String,
) -> Result<String, String> {
    let _operation = db.operation.lock().await;
    let password = Zeroizing::new(password);
    if paths.vault.exists() {
        return Err("La protection est déjà en place.".to_string());
    }
    let database_existed = paths.database.exists();
    if database_existed && !database::is_plaintext_sqlite(&paths.database).unwrap_or(false) {
        return Err(
            "Le fichier des clés (vault.json) a disparu. Restaurez une sauvegarde pour retrouver vos données."
                .to_string(),
        );
    }

    let (vault, key, recovery) =
        derive(move || Vault::create(&password, KdfParams::STANDARD)).await?;
    // Le coffre est écrit avant de chiffrer la base : si l'app s'arrête pendant la
    // conversion, le prochain déverrouillage la reprend avec la même clé.
    vault
        .save(&paths.vault)
        .map_err(|error| error.to_string())?;

    if let Err(error) = open_with_key(&app, &db, &paths, key)
        .await
        .map_err(open_error)
    {
        // Rien n'a été chiffré (la base est encore en clair ou n'existait pas) :
        // on revient à l'état de départ pour pouvoir réessayer.
        let untouched = !paths.database.exists()
            || database::is_plaintext_sqlite(&paths.database).unwrap_or(false);
        if untouched || !database_existed {
            if !database_existed {
                let _ = database::remove_with_sidecars(&paths.database);
            }
            let _ = std::fs::remove_file(&paths.vault);
        }
        return Err(error);
    }
    Ok(recovery.display().to_string())
}

#[tauri::command]
pub async fn unlock_with_password(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    password: String,
) -> Result<SecurityStatus, String> {
    let _operation = db.operation.lock().await;
    if db.is_unlocked() {
        return Ok(status(&db, &paths));
    }
    slow_down_after_failures().await;
    let vault = Vault::load(&paths.vault).map_err(|error| error.to_string())?;
    let password = Zeroizing::new(password);
    let key = derive(move || vault.unlock_with_password(&password))
        .await
        .inspect_err(|_| {
            FAILED_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
        })?;
    open_with_key(&app, &db, &paths, key)
        .await
        .map_err(open_error)
}

/// Mot de passe oublié : la clé de secours ouvre l'app et un nouveau mot de passe
/// remplace l'ancien, en une seule étape.
#[tauri::command]
pub async fn unlock_with_recovery_key(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    recovery_key: String,
    new_password: String,
) -> Result<SecurityStatus, String> {
    let _operation = db.operation.lock().await;
    slow_down_after_failures().await;
    let mut vault = Vault::load(&paths.vault).map_err(|error| error.to_string())?;
    let recovery_key = Zeroizing::new(recovery_key);
    let new_password = Zeroizing::new(new_password);
    crate::security::vault::check_new_password(&new_password).map_err(|error| error.to_string())?;
    let vault = derive(move || {
        let key = vault.unlock_with_recovery(&recovery_key)?;
        vault.set_password(&key, &new_password)?;
        Ok((vault, key))
    })
    .await
    .inspect_err(|_| {
        FAILED_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
    })?;
    let (vault, key) = vault;
    vault
        .save(&paths.vault)
        .map_err(|error| error.to_string())?;
    if db.is_unlocked() {
        return Ok(status(&db, &paths));
    }
    open_with_key(&app, &db, &paths, key)
        .await
        .map_err(open_error)
}

#[tauri::command]
pub async fn unlock_with_touch_id(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<SecurityStatus, String> {
    let _operation = db.operation.lock().await;
    if db.is_unlocked() {
        return Ok(status(&db, &paths));
    }
    let settings = config::load_settings(&paths).unwrap_or_default();
    if !settings.security.touch_id || !biometry::available() {
        return Err("Touch ID n'est pas activé. Saisissez le mot de passe.".to_string());
    }
    let outcome = tauri::async_runtime::spawn_blocking(|| {
        biometry::authenticate("déverrouiller vos données")
    })
    .await
    .map_err(|_| "Touch ID interrompu.".to_string())?;
    match outcome {
        BiometryOutcome::Success => {}
        BiometryOutcome::Cancelled => return Err(String::new()),
        BiometryOutcome::Failed => {
            return Err("Empreinte non reconnue. Saisissez le mot de passe.".to_string())
        }
    }

    let disable = |paths: &AppPaths| {
        biometry::delete_key();
        let _ = config::modify_settings(paths, |settings| settings.security.touch_id = false);
    };
    let Some(key) = biometry::load_key() else {
        disable(&paths);
        return Err(
            "La clé Touch ID est introuvable dans le Trousseau. Saisissez le mot de passe, puis réactivez Touch ID dans les réglages."
                .to_string(),
        );
    };
    match open_with_key(&app, &db, &paths, key).await {
        Err(OpenError::WrongKey) => {
            // Clé périmée (ex. après une restauration).
            disable(&paths);
            Err("Touch ID ne correspond plus à ces données. Saisissez le mot de passe, puis réactivez Touch ID.".to_string())
        }
        other => other.map_err(open_error),
    }
}

/// Ferme la base. Une sauvegarde est faite d'abord si la dernière date de plus d'une heure.
#[tauri::command]
pub async fn lock_app(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<SecurityStatus, String> {
    let _operation = db.operation.lock().await;
    if let (Ok(pool), Ok(key)) = (db.pool(), db.key()) {
        let _ = backup_if_due(&app, &paths, &pool, &key, 1).await;
    }
    if let Some(unlocked) = db.take() {
        unlocked.pool.close().await;
    }
    config::clear_opened(&paths);
    Ok(status(&db, &paths))
}

/// Ferme la base à la sortie de l'app, après une dernière sauvegarde si besoin.
pub async fn on_exit(app: &AppHandle, db: &Db, paths: &AppPaths) {
    let _operation = db.operation.lock().await;
    if let (Ok(pool), Ok(key)) = (db.pool(), db.key()) {
        let _ = backup_now(app, paths, &pool, &key, false).await;
    }
    if let Some(unlocked) = db.take() {
        unlocked.pool.close().await;
    }
    config::clear_opened(paths);
}

#[tauri::command]
pub async fn change_password(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let _operation = db.operation.lock().await;
    db.key()?;
    let mut vault = Vault::load(&paths.vault).map_err(|error| error.to_string())?;
    let current = Zeroizing::new(current_password);
    let new_password = Zeroizing::new(new_password);
    let vault = derive(move || {
        let key = vault
            .unlock_with_password(&current)
            .map_err(|error| match error {
                VaultError::WrongSecret => {
                    VaultError::Invalid("Le mot de passe actuel est incorrect.")
                }
                other => other,
            })?;
        vault.set_password(&key, &new_password)?;
        Ok(vault)
    })
    .await?;
    vault.save(&paths.vault).map_err(|error| error.to_string())
}

/// Nouvelle clé de secours (l'ancienne cesse de fonctionner). Demande le mot de passe.
#[tauri::command]
pub async fn renew_recovery_key(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    password: String,
) -> Result<String, String> {
    let _operation = db.operation.lock().await;
    db.key()?;
    let mut vault = Vault::load(&paths.vault).map_err(|error| error.to_string())?;
    let password = Zeroizing::new(password);
    let (vault, recovery) = derive(move || {
        let key = vault.unlock_with_password(&password)?;
        let recovery = vault.renew_recovery(&key)?;
        Ok((vault, Zeroizing::new(recovery.display().to_string())))
    })
    .await?;
    vault
        .save(&paths.vault)
        .map_err(|error| error.to_string())?;
    Ok(recovery.to_string())
}

#[tauri::command]
pub async fn set_touch_id(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    enabled: bool,
) -> Result<SecurityStatus, String> {
    let _operation = db.operation.lock().await;
    let key = db.key()?;
    if enabled {
        if !biometry::available() {
            return Err("Touch ID n'est pas disponible sur ce Mac.".to_string());
        }
        let outcome = tauri::async_runtime::spawn_blocking(|| {
            biometry::authenticate("activer le déverrouillage par Touch ID")
        })
        .await
        .map_err(|_| "Touch ID interrompu.".to_string())?;
        if outcome != BiometryOutcome::Success {
            return Err("Touch ID n'a pas été confirmé.".to_string());
        }
        biometry::store_key(&key)?;
    } else {
        biometry::delete_key();
    }
    config::modify_settings(&paths, |settings| settings.security.touch_id = enabled)
        .map_err(settings_error)?;
    Ok(status(&db, &paths))
}

#[tauri::command]
pub fn set_auto_lock(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    minutes: u32,
) -> Result<SecurityStatus, String> {
    db.pool()?;
    if !AUTO_LOCK_CHOICES.contains(&minutes) {
        return Err("Durée de verrouillage non proposée.".to_string());
    }
    config::modify_settings(&paths, |settings| {
        settings.security.auto_lock_minutes = minutes
    })
    .map_err(settings_error)?;
    Ok(status(&db, &paths))
}

// ---------------------------------------------------------------------------
// Sauvegardes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    /// `CREATED`, `UNCHANGED` (rien de neuf depuis la dernière) ou `SKIPPED`.
    pub result: &'static str,
    pub settings: config::BackupSettings,
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

async fn backup_now(
    app: &AppHandle,
    paths: &AppPaths,
    pool: &sqlx::SqlitePool,
    key: &MasterKey,
    force: bool,
) -> Result<BackupOutcome, String> {
    let settings = config::load_settings(paths).map_err(settings_error)?;
    let Some(folder) = settings.backup.folder.clone() else {
        return Err("Choisissez d'abord un dossier de sauvegarde.".to_string());
    };
    let folder = PathBuf::from(folder);

    let attempt = async {
        let fingerprint = external_backup::fingerprint(pool).await.map_err(|error| {
            eprintln!("sauvegarde : empreinte ({error})");
            "La base n'a pas pu être lue pour la sauvegarde.".to_string()
        })?;
        let latest_present = external_backup::list(&folder)
            .map_err(|error| error.to_string())?
            .first()
            .is_some_and(|entry| entry.readable);
        if !force
            && latest_present
            && settings.backup.last_fingerprint.as_deref() == Some(fingerprint.as_str())
        {
            return Ok(("UNCHANGED", fingerprint));
        }
        external_backup::create(
            pool,
            key,
            paths,
            &folder,
            &version(app),
            fingerprint.clone(),
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok::<_, String>(("CREATED", fingerprint))
    }
    .await;

    let stamp = now();
    let saved = config::modify_settings(paths, |settings| match &attempt {
        Ok((result, fingerprint)) => {
            if *result == "CREATED" {
                settings.backup.last_backup_at = Some(stamp.clone());
            }
            settings.backup.last_check_at = Some(stamp.clone());
            settings.backup.last_fingerprint = Some(fingerprint.clone());
            settings.backup.last_error = None;
        }
        Err(message) => settings.backup.last_error = Some(message.clone()),
    })
    .map_err(settings_error)?;

    attempt.map(|(result, _)| BackupOutcome {
        result,
        settings: saved.backup,
    })
}

async fn backup_if_due(
    app: &AppHandle,
    paths: &AppPaths,
    pool: &sqlx::SqlitePool,
    key: &MasterKey,
    max_age_hours: i64,
) -> Result<BackupOutcome, String> {
    let settings = config::load_settings(paths).map_err(settings_error)?;
    let recent = settings
        .backup
        .last_check_at
        .as_deref()
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .is_some_and(|last| {
            chrono::Local::now().signed_duration_since(last)
                < chrono::Duration::hours(max_age_hours)
        });
    if settings.backup.folder.is_none() || recent {
        return Ok(BackupOutcome {
            result: "SKIPPED",
            settings: settings.backup,
        });
    }
    backup_now(app, paths, pool, key, false).await
}

#[tauri::command]
pub async fn run_backup(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<BackupOutcome, String> {
    let _operation = db.operation.lock().await;
    let (pool, key) = (db.pool()?, db.key()?);
    backup_now(&app, &paths, &pool, &key, true).await
}

/// Appelée régulièrement par l'écran : sauvegarde si la dernière date de plus de 24 h.
#[tauri::command]
pub async fn run_backup_if_due(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
) -> Result<BackupOutcome, String> {
    let _operation = db.operation.lock().await;
    let (pool, key) = (db.pool()?, db.key()?);
    backup_if_due(&app, &paths, &pool, &key, 24).await
}

#[tauri::command]
pub fn set_backup_folder(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    folder: Option<String>,
) -> Result<config::BackupSettings, String> {
    db.pool()?;
    let folder = folder.map(|folder| {
        external_backup::normalize_folder(Path::new(&folder))
            .display()
            .to_string()
    });
    if let Some(folder) = &folder {
        let path = Path::new(folder);
        if !path.is_absolute() || !path.is_dir() {
            return Err("Ce dossier est introuvable.".to_string());
        }
        if path.starts_with(&paths.root) {
            return Err(
                "Choisissez un dossier en dehors des données de Tracink (iCloud Drive, disque externe…)."
                    .to_string(),
            );
        }
    }
    let changed = config::load_settings(&paths)
        .map(|settings| settings.backup.folder != folder)
        .unwrap_or(true);
    config::modify_settings(&paths, |settings| {
        if changed {
            // Nouveau dossier : la prochaine sauvegarde y est faite sans attendre.
            settings.backup.last_check_at = None;
            settings.backup.last_fingerprint = None;
            settings.backup.last_error = None;
        }
        settings.backup.folder = folder;
    })
    .map(|settings| settings.backup)
    .map_err(settings_error)
}

#[tauri::command]
pub fn get_backup_settings(paths: State<'_, AppPaths>) -> Result<config::BackupSettings, String> {
    config::load_settings(&paths)
        .map(|settings| settings.backup)
        .map_err(settings_error)
}

/// Sauvegardes d'un dossier. Sans dossier, celui des réglages.
#[tauri::command]
pub fn list_backups(
    paths: State<'_, AppPaths>,
    folder: Option<String>,
) -> Result<Vec<BackupEntry>, String> {
    let folder = match folder {
        Some(folder) => folder,
        None => config::load_settings(&paths)
            .ok()
            .and_then(|settings| settings.backup.folder)
            .ok_or_else(|| "Aucun dossier de sauvegarde choisi.".to_string())?,
    };
    external_backup::list(Path::new(&folder)).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreInput {
    folder: String,
    name: String,
    password: Option<String>,
    recovery_key: Option<String>,
    new_password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub status: SecurityStatus,
    /// Où les données remplacées ont été mises de côté.
    pub previous_data: String,
}

/// Remplace toutes les données par une sauvegarde.
///
/// Avec la clé de secours, un nouveau mot de passe est obligatoire. Les données
/// remplacées sont gardées dans `avant-restauration-<horodatage>/`.
#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    input: RestoreInput,
) -> Result<RestoreOutcome, String> {
    let _operation = db.operation.lock().await;
    let RestoreInput {
        folder,
        name,
        password,
        recovery_key,
        new_password,
    } = input;
    let password = password.map(Zeroizing::new);
    let recovery_key = recovery_key.map(Zeroizing::new);
    let new_password = new_password.map(Zeroizing::new);
    let secret = match (&password, &recovery_key) {
        (Some(password), None) => Secret::Password(password.as_str()),
        (None, Some(recovery)) => {
            let Some(new_password) = &new_password else {
                return Err("Choisissez un nouveau mot de passe.".to_string());
            };
            crate::security::vault::check_new_password(new_password)
                .map_err(|error| error.to_string())?;
            Secret::RecoveryKey(recovery.as_str())
        }
        _ => {
            return Err(
                "Saisissez le mot de passe de la sauvegarde ou la clé de secours.".to_string(),
            )
        }
    };
    // Verrouillé : il faut d'abord déverrouiller (seuls un Mac neuf ou un coffre
    // disparu permettent de restaurer sans le mot de passe actuel).
    if paths.vault.exists() && !db.is_unlocked() {
        return Err(database::LOCKED_MESSAGE.to_string());
    }
    let folder = PathBuf::from(folder);
    let verified = external_backup::verify(&folder, &name, secret)
        .await
        .map_err(|error| error.to_string())?;

    // À partir d'ici, les données actuelles sont remplacées.
    if let Some(unlocked) = db.take() {
        unlocked.pool.close().await;
    }
    config::clear_opened(&paths);
    let aside = external_backup::replace_current_data(&paths, &verified)
        .map_err(|error| error.to_string())?;

    if let Some(new_password) = new_password.filter(|_| recovery_key.is_some()) {
        let mut vault = Vault::load(&paths.vault).map_err(|error| error.to_string())?;
        let key = verified.key.clone();
        let vault = derive(move || {
            vault.set_password(&key, &new_password)?;
            Ok(vault)
        })
        .await?;
        vault
            .save(&paths.vault)
            .map_err(|error| error.to_string())?;
    }

    let key = verified.key.clone();
    let touch_id = config::load_settings(&paths)
        .map(|settings| settings.security.touch_id)
        .unwrap_or(false);
    if touch_id && biometry::store_key(&key).is_err() {
        let _ = config::modify_settings(&paths, |settings| settings.security.touch_id = false);
    }
    config::modify_settings(&paths, |settings| {
        if settings.backup.folder.is_none() {
            settings.backup.folder = Some(folder.display().to_string());
        }
        settings.backup.last_fingerprint = None;
        settings.backup.last_check_at = None;
    })
    .map_err(settings_error)?;

    let status = open_with_key(&app, &db, &paths, key)
        .await
        .map_err(open_error)?;
    Ok(RestoreOutcome {
        status,
        previous_data: aside.display().to_string(),
    })
}

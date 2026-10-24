//! Réinitialisation sur ce Mac.
//!
//! Deux portées, après le mot de passe ou Touch ID :
//! - les données métier : base vide sous la même clé, coffre et réglages gardés ;
//! - l'installation : coffre, réglages, Trousseau et données effacés, retour à
//!   la création du mot de passe.
//!
//! Les sauvegardes externes, hors du dossier de l'app, ne sont pas touchées.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use zeroize::Zeroizing;

use super::attempts;
use super::biometry::{self, BiometryOutcome};
use super::rotation;
use super::vault::{MasterKey, Vault};
use crate::config::{self, AppPaths};
use crate::database::{self, Db, Unlocked};
use crate::services::audit::{self, event};
use crate::services::sql;

const FRESH_NAME: &str = "database.sqlite.resetting";
const ASIDE_NAME: &str = "database.sqlite.previous";
const INCOMPLETE: &str = "La réinitialisation n'a pas abouti. Réessaie.";

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResetScope {
    /// Base vide, même mot de passe.
    #[default]
    Data,
    /// Coffre, réglages et données effacés.
    Installation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "method")]
pub enum ResetProof {
    Password {
        password: String,
        #[serde(default)]
        scope: ResetScope,
    },
    TouchId {
        #[serde(default)]
        scope: ResetScope,
    },
}

impl ResetProof {
    fn scope(&self) -> ResetScope {
        match self {
            Self::Password { scope, .. } | Self::TouchId { scope } => *scope,
        }
    }

    fn into_password(self) -> Option<String> {
        match self {
            Self::Password { password, .. } => Some(password),
            Self::TouchId { .. } => None,
        }
    }
}

/// Efface selon la portée, après preuve du mot de passe ou de Touch ID.
pub async fn run(db: &Db, paths: &AppPaths, proof: ResetProof) -> Result<(), String> {
    let _operation = db.operation.lock().await;
    if rotation::is_pending(paths) {
        return Err(
            "Un rechiffrement est en cours. Termine-le d'abord, puis réessaie.".to_string(),
        );
    }
    let key = db.key()?;
    let scope = proof.scope();
    authorize(paths, &key, proof).await?;
    // Un essai précédent a pu laisser l'ancienne base à côté : l'effacer tant
    // que l'app est encore ouverte sur la base courante.
    remove_file(&aside_path(paths))?;

    match scope {
        ResetScope::Data => reset_data(db, paths, key).await,
        ResetScope::Installation => reset_installation(db, paths, &key).await,
    }
}

/// Base vide sous la même clé. L'app reste déverrouillée.
async fn reset_data(db: &Db, paths: &AppPaths, key: MasterKey) -> Result<(), String> {
    let fresh = prepare_fresh(paths, &key).await?;
    if let Some(unlocked) = db.take() {
        unlocked.pool.close().await;
    }

    let swapped = wipe_and_swap(paths, &fresh);
    if let Err(error) = swapped {
        if !db.is_unlocked() {
            reopen(db, paths, &key).await;
        }
        let _ = database::remove_with_sidecars(&fresh);
        return Err(error);
    }

    match database::connect_encrypted(&paths.database, &key, false).await {
        Ok(pool) => {
            db.set(Unlocked { pool, key });
            Ok(())
        }
        Err(error) => {
            eprintln!("réinitialisation : réouverture ({error})");
            Err(INCOMPLETE.to_string())
        }
    }
}

/// Coffre, réglages, Trousseau et fichiers de données. L'app reste fermée :
/// au prochain affichage, le coffre absent ramène à la création du mot de passe.
async fn reset_installation(db: &Db, paths: &AppPaths, key: &MasterKey) -> Result<(), String> {
    if let Some(unlocked) = db.take() {
        unlocked.pool.close().await;
    }
    if let Err(error) = wipe_local_files(paths) {
        if paths.database.exists() {
            reopen(db, paths, key).await;
        }
        return Err(error);
    }
    remove_plain(&paths.vault)?;
    remove_plain(&paths.settings)?;
    biometry::delete_key();
    Ok(())
}

async fn authorize(paths: &AppPaths, current: &MasterKey, proof: ResetProof) -> Result<(), String> {
    let installation = proof.scope() == ResetScope::Installation;
    match proof.into_password() {
        None => authorize_touch_id(paths, installation).await,
        Some(password) => authorize_password(paths, current, password).await,
    }
}

async fn authorize_touch_id(paths: &AppPaths, installation: bool) -> Result<(), String> {
    let settings = config::load_settings(paths).unwrap_or_default();
    if !settings.security.touch_id || !biometry::available() {
        return Err("Touch ID n'est pas activé. Saisissez le mot de passe.".to_string());
    }
    let reason = if installation {
        "réinitialiser Tracink"
    } else {
        "réinitialiser les données de Tracink"
    };
    let outcome = tauri::async_runtime::spawn_blocking(move || biometry::authenticate(reason))
        .await
        .map_err(|_| "Touch ID interrompu.".to_string())?;
    match outcome {
        BiometryOutcome::Success => Ok(()),
        BiometryOutcome::Cancelled => Err(String::new()),
        BiometryOutcome::Failed => {
            Err("Empreinte non reconnue. Saisissez le mot de passe.".to_string())
        }
    }
}

async fn authorize_password(
    paths: &AppPaths,
    current: &MasterKey,
    password: String,
) -> Result<(), String> {
    attempts::slow_down().await;
    let vault = Vault::load(&paths.vault).map_err(|error| error.to_string())?;
    let password = Zeroizing::new(password);
    let opened =
        tauri::async_runtime::spawn_blocking(move || vault.unlock_with_password(&password))
            .await
            .map_err(|_| "Opération interrompue.".to_string())?
            .map_err(|error| {
                attempts::record_failure();
                error.to_string()
            })?;
    if !same_key(&opened, current) {
        attempts::record_failure();
        return Err("Ce mot de passe ne correspond pas aux données ouvertes.".to_string());
    }
    attempts::clear_failures();
    Ok(())
}

fn same_key(left: &MasterKey, right: &MasterKey) -> bool {
    let mut diff = 0_u8;
    for (a, b) in left.as_bytes().iter().zip(right.as_bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// Base vide, migrée, avec l'événement `DATA_RESET` et rien d'autre.
async fn prepare_fresh(paths: &AppPaths, key: &MasterKey) -> Result<PathBuf, String> {
    let fresh = paths.root.join(FRESH_NAME);
    remove_file(&fresh)?;
    let pool = match database::connect_encrypted(&fresh, key, true).await {
        Ok(pool) => pool,
        Err(error) => {
            let _ = database::remove_with_sidecars(&fresh);
            eprintln!("réinitialisation : base vide ({error})");
            return Err(INCOMPLETE.to_string());
        }
    };
    if let Err(error) = sqlx::migrate!("./migrations").run(&pool).await {
        pool.close().await;
        let _ = database::remove_with_sidecars(&fresh);
        eprintln!("réinitialisation : migrations ({error})");
        return Err(INCOMPLETE.to_string());
    }
    if let Err(error) = audit::record_event(&pool, event::DATA_RESET, serde_json::Value::Null).await
    {
        pool.close().await;
        let _ = database::remove_with_sidecars(&fresh);
        sql::log_database_error(&error);
        return Err(sql::DATABASE_MESSAGE.to_string());
    }
    pool.close().await;
    Ok(fresh)
}

/// Documents, photos, copies locales et base. Le coffre et les réglages restent.
fn wipe_local_files(paths: &AppPaths) -> Result<(), String> {
    clear_children(&paths.documents)?;
    clear_children(&paths.photos)?;
    clear_children(&paths.backups)?;
    config::clear_opened(paths);
    remove_file(&paths.root.join("database.pre-rotation"))?;
    remove_plain(&rotation::journal_path(paths))?;
    remove_file(&paths.root.join(FRESH_NAME))?;
    remove_file(&paths.database)?;
    Ok(())
}

fn wipe_and_swap(paths: &AppPaths, fresh: &Path) -> Result<(), String> {
    clear_children(&paths.documents)?;
    clear_children(&paths.photos)?;
    clear_children(&paths.backups)?;
    config::clear_opened(paths);
    remove_file(&paths.root.join("database.pre-rotation"))?;

    let aside = aside_path(paths);
    database::move_with_sidecars(&paths.database, &aside).map_err(file_error)?;
    if let Err(error) = database::move_with_sidecars(fresh, &paths.database) {
        let _ = database::move_with_sidecars(&aside, &paths.database);
        return Err(file_error(error));
    }
    remove_file(&aside)?;
    Ok(())
}

async fn reopen(db: &Db, paths: &AppPaths, key: &MasterKey) {
    match database::connect_encrypted(&paths.database, key, false).await {
        Ok(pool) => db.set(Unlocked {
            pool,
            key: key.clone(),
        }),
        Err(error) => eprintln!("réinitialisation : base d'origine non rouverte ({error})"),
    }
}

fn aside_path(paths: &AppPaths) -> PathBuf {
    paths.root.join(ASIDE_NAME)
}

fn remove_file(path: &Path) -> Result<(), String> {
    database::remove_with_sidecars(path).map_err(file_error)
}

fn remove_plain(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(file_error(error)),
    }
}

fn clear_children(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(file_error)?;
    for entry in entries {
        let path = entry.map_err(file_error)?.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if let Err(error) = result {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(file_error(error));
            }
        }
    }
    Ok(())
}

fn file_error(error: std::io::Error) -> String {
    eprintln!("réinitialisation : fichier ({})", error.kind());
    INCOMPLETE.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppSettings;
    use crate::security::vault::KdfParams;
    use std::time::{SystemTime, UNIX_EPOCH};

    const PASSWORD: &str = "atelier secret";

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "tracink-reset-{name}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn paths(&self) -> AppPaths {
            let paths = AppPaths::under(self.0.join("data"), self.0.join("ouverts"));
            for dir in [&paths.root, &paths.documents, &paths.photos, &paths.backups] {
                fs::create_dir_all(dir).unwrap();
            }
            paths
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct Fixture {
        _dir: TempDir,
        paths: AppPaths,
        db: Db,
        vault_bytes: Vec<u8>,
        settings_bytes: Vec<u8>,
    }

    impl Fixture {
        async fn install() -> Self {
            let dir = TempDir::new("data");
            let paths = dir.paths();
            let (vault, key, _) = Vault::create(PASSWORD, KdfParams::FAST).unwrap();
            vault.save(&paths.vault).unwrap();
            let mut settings = AppSettings::default();
            settings.studio.professional_name = "Nadia".to_string();
            settings.studio.city = "Lyon".to_string();
            settings.backup.folder = Some("/sauvegardes-externes".to_string());
            config::save_settings(&paths, &settings).unwrap();

            let pool = database::open(&paths, &key, "test").await.unwrap();
            sqlx::query(
                "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
                 VALUES ('c1', 'Alice', 'Martin', '2026-01-01', '2026-01-01')",
            )
            .execute(&pool)
            .await
            .unwrap();
            crate::backup::snapshot_database(&pool, &paths.backups, "test")
                .await
                .unwrap();
            let db = Db::default();
            db.set(Unlocked { pool, key });

            fs::create_dir_all(paths.documents.join("s1")).unwrap();
            fs::write(paths.documents.join("s1/scan.pdf"), b"scan").unwrap();
            fs::write(paths.photos.join("bras.jpg"), b"photo").unwrap();
            fs::create_dir_all(&paths.opened).unwrap();
            fs::write(paths.opened.join("clair.pdf"), b"clair").unwrap();
            fs::write(paths.root.join("database.pre-rotation"), b"ancienne").unwrap();

            Self {
                vault_bytes: fs::read(&paths.vault).unwrap(),
                settings_bytes: fs::read(&paths.settings).unwrap(),
                paths,
                db,
                _dir: dir,
            }
        }
    }

    async fn client_count(db: &Db) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM clients")
            .fetch_one(&db.pool().unwrap())
            .await
            .unwrap()
    }

    fn dir_is_empty(path: &Path) -> bool {
        fs::read_dir(path).unwrap().next().is_none()
    }

    #[tokio::test]
    async fn password_resets_local_data_and_keeps_the_vault() {
        let fixture = Fixture::install().await;
        run(
            &fixture.db,
            &fixture.paths,
            ResetProof::Password {
                password: PASSWORD.to_string(),
                scope: ResetScope::Data,
            },
        )
        .await
        .unwrap();

        assert!(fixture.db.is_unlocked());
        assert_eq!(client_count(&fixture.db).await, 0);
        assert!(dir_is_empty(&fixture.paths.documents));
        assert!(dir_is_empty(&fixture.paths.photos));
        assert!(dir_is_empty(&fixture.paths.backups));
        assert!(!fixture.paths.opened.join("clair.pdf").exists());
        assert!(!fixture.paths.root.join("database.pre-rotation").exists());
        assert!(!fixture.paths.root.join(FRESH_NAME).exists());
        assert!(!aside_path(&fixture.paths).exists());
        assert_eq!(fs::read(&fixture.paths.vault).unwrap(), fixture.vault_bytes);
        assert_eq!(
            fs::read(&fixture.paths.settings).unwrap(),
            fixture.settings_bytes
        );

        let key = fixture.db.key().unwrap();
        let pool = database::connect_encrypted(&fixture.paths.database, &key, false)
            .await
            .unwrap();
        let resets: Vec<String> = sqlx::query_scalar(
            "SELECT action FROM audit_log WHERE entity = 'app' AND action = 'DATA_RESET'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(resets, vec!["DATA_RESET".to_string()]);
        let detail: Option<String> =
            sqlx::query_scalar("SELECT after_json FROM audit_log WHERE action = 'DATA_RESET'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(detail.is_none());
        let mentions: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM audit_log
             WHERE IFNULL(label, '') LIKE '%Alice%' OR IFNULL(after_json, '') LIKE '%Alice%'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(mentions, 0);
        pool.close().await;
    }

    #[tokio::test]
    async fn wrong_password_leaves_data_in_place() {
        let fixture = Fixture::install().await;
        let error = run(
            &fixture.db,
            &fixture.paths,
            ResetProof::Password {
                password: "mauvais mot".to_string(),
                scope: ResetScope::Data,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error, "Mot de passe incorrect.");
        assert_eq!(client_count(&fixture.db).await, 1);
        assert!(fixture.paths.documents.join("s1/scan.pdf").exists());
        assert!(fixture.paths.photos.join("bras.jpg").exists());
        assert_eq!(fs::read(&fixture.paths.vault).unwrap(), fixture.vault_bytes);
        assert_eq!(
            fs::read(&fixture.paths.settings).unwrap(),
            fixture.settings_bytes
        );
    }

    #[tokio::test]
    async fn touch_id_disabled_is_refused_without_wiping() {
        let fixture = Fixture::install().await;
        let error = run(
            &fixture.db,
            &fixture.paths,
            ResetProof::TouchId {
                scope: ResetScope::Data,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(
            error,
            "Touch ID n'est pas activé. Saisissez le mot de passe."
        );
        assert_eq!(client_count(&fixture.db).await, 1);
        assert!(fixture.paths.documents.join("s1/scan.pdf").exists());
        assert!(fixture.paths.root.join("database.pre-rotation").exists());
    }

    #[tokio::test]
    async fn pending_rotation_is_refused() {
        let fixture = Fixture::install().await;
        fs::write(rotation::journal_path(&fixture.paths), b"{}").unwrap();
        let error = run(
            &fixture.db,
            &fixture.paths,
            ResetProof::Password {
                password: PASSWORD.to_string(),
                scope: ResetScope::Data,
            },
        )
        .await
        .unwrap_err();
        assert!(error.contains("rechiffrement"));
        assert_eq!(client_count(&fixture.db).await, 1);
        assert!(rotation::journal_path(&fixture.paths).exists());
    }

    #[tokio::test]
    async fn locked_app_is_refused() {
        let dir = TempDir::new("locked");
        let paths = dir.paths();
        let error = run(
            &Db::default(),
            &paths,
            ResetProof::Password {
                password: PASSWORD.to_string(),
                scope: ResetScope::Data,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error, database::LOCKED_MESSAGE);
    }

    #[tokio::test]
    async fn password_wipes_the_installation() {
        let fixture = Fixture::install().await;
        let external = fixture
            .paths
            .root
            .parent()
            .unwrap()
            .join("sauvegarde-externe.txt");
        fs::write(&external, b"copie").unwrap();

        run(
            &fixture.db,
            &fixture.paths,
            ResetProof::Password {
                password: PASSWORD.to_string(),
                scope: ResetScope::Installation,
            },
        )
        .await
        .unwrap();

        assert!(!fixture.db.is_unlocked());
        assert!(!fixture.paths.vault.exists());
        assert!(!fixture.paths.settings.exists());
        assert!(!fixture.paths.database.exists());
        assert!(!fixture.paths.documents.join("s1/scan.pdf").exists());
        assert!(dir_is_empty(&fixture.paths.photos));
        assert!(dir_is_empty(&fixture.paths.backups));
        assert!(!fixture.paths.opened.join("clair.pdf").exists());
        assert!(!fixture.paths.root.join("database.pre-rotation").exists());
        assert_eq!(fs::read(&external).unwrap(), b"copie");
    }

    #[tokio::test]
    async fn wrong_password_does_not_wipe_the_installation() {
        let fixture = Fixture::install().await;
        let error = run(
            &fixture.db,
            &fixture.paths,
            ResetProof::Password {
                password: "mauvais mot".to_string(),
                scope: ResetScope::Installation,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error, "Mot de passe incorrect.");
        assert_eq!(client_count(&fixture.db).await, 1);
        assert_eq!(fs::read(&fixture.paths.vault).unwrap(), fixture.vault_bytes);
        assert!(fixture.paths.settings.exists());
    }
}

//! Sauvegardes complètes vers un dossier choisi (iCloud Drive, disque externe…)
//! et restauration.
//!
//! Une sauvegarde est un dossier `Tracink-sauvegardes/<AAAA-MM-JJ-HHMMSS>/` qui
//! contient tout ce qu'il faut pour repartir, sur ce Mac ou un autre :
//! - `database.sqlite` : copie cohérente de la base, chiffrée (VACUUM INTO) ;
//! - `documents/`, `photos/` : fichiers déjà chiffrés, copiés tels quels ;
//! - `vault.json` : la clé maître chiffrée (mot de passe et clé de secours) ;
//! - `manifest.json` : version, date, empreinte et nombres de fichiers.
//!
//! Rien n'y est en clair. Le dossier est écrit sous un nom `.partial` puis renommé :
//! une sauvegarde visible est toujours complète.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use blake2::{Blake2b, Digest};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::config::AppPaths;
use crate::database;
use crate::security::files;
use crate::security::vault::{MasterKey, Vault, VaultError};

pub const DIR_NAME: &str = "Tracink-sauvegardes";
pub const KEEP: usize = 30;
const MANIFEST_FORMAT: u32 = 1;

#[derive(Debug)]
pub enum BackupError {
    FolderMissing,
    Invalid(String),
    Io(io::ErrorKind),
    Database(String),
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FolderMissing => write!(
                f,
                "Le dossier de sauvegarde est introuvable. Le disque est-il branché ?"
            ),
            Self::Invalid(message) | Self::Database(message) => write!(f, "{message}"),
            Self::Io(kind) => match kind {
                io::ErrorKind::PermissionDenied => write!(
                    f,
                    "Tracink n'a pas le droit d'écrire dans le dossier de sauvegarde."
                ),
                io::ErrorKind::StorageFull => {
                    write!(f, "Le disque de sauvegarde est plein.")
                }
                _ => write!(f, "La sauvegarde n'a pas pu être écrite ({kind})."),
            },
        }
    }
}

impl std::error::Error for BackupError {}

impl From<io::Error> for BackupError {
    fn from(error: io::Error) -> Self {
        eprintln!("sauvegarde : erreur de fichier ({})", error.kind());
        Self::Io(error.kind())
    }
}

impl From<VaultError> for BackupError {
    fn from(error: VaultError) -> Self {
        Self::Invalid(error.to_string())
    }
}

impl From<database::OpenError> for BackupError {
    fn from(error: database::OpenError) -> Self {
        Self::Database(match error {
            database::OpenError::WrongKey => {
                "La base de cette sauvegarde ne correspond pas à sa clé : elle est inutilisable."
                    .to_string()
            }
            other => other.to_string(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub app: String,
    pub format: u32,
    pub app_version: String,
    pub created_at: String,
    pub fingerprint: String,
    /// Dernière migration appliquée à la base sauvegardée.
    pub migration: i64,
    pub documents: usize,
    pub photos: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub created_at: Option<String>,
    pub app_version: Option<String>,
    pub documents: usize,
    pub size_bytes: u64,
    /// Faux si le manifeste manque ou est illisible.
    pub readable: bool,
}

/// Empreinte du contenu de la base (toutes les tables, ligne à ligne).
///
/// Une copie chiffrée change d'octets à chaque écriture (vecteurs aléatoires) :
/// on compare donc le contenu, pour ne pas refaire une sauvegarde identique.
pub async fn fingerprint(pool: &SqlitePool) -> Result<String, sqlx::Error> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    let mut hasher = Blake2b::<blake2::digest::consts::U32>::new();
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
                .bind(&table)
                .fetch_all(pool)
                .await?;
        if columns.is_empty() {
            continue;
        }
        let row_expr = columns
            .iter()
            .map(|column| format!("quote(\"{}\")", column.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" || char(31) || ");
        let rows: Vec<String> = sqlx::query_scalar(&format!(
            "SELECT {row_expr} FROM \"{quoted}\" ORDER BY rowid"
        ))
        .fetch_all(pool)
        .await?;
        hasher.update(table.as_bytes());
        hasher.update([0x1d]);
        for row in rows {
            hasher.update(row.as_bytes());
            hasher.update([0x1e]);
        }
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn backups_root(folder: &Path) -> Result<PathBuf, BackupError> {
    if !folder.is_dir() {
        return Err(BackupError::FolderMissing);
    }
    // Le dossier choisi peut être `Tracink-sauvegardes` lui-même.
    if folder.file_name().is_some_and(|name| name == DIR_NAME) {
        return Ok(folder.to_path_buf());
    }
    Ok(folder.join(DIR_NAME))
}

/// Dossier à enregistrer dans les réglages : le parent si `Tracink-sauvegardes` a été choisi.
pub fn normalize_folder(folder: &Path) -> PathBuf {
    match (folder.file_name(), folder.parent()) {
        (Some(name), Some(parent)) if name == DIR_NAME => parent.to_path_buf(),
        _ => folder.to_path_buf(),
    }
}

/// Un nom de sauvegarde est un horodatage `AAAA-MM-JJ-HHMMSS` (éventuellement `-2`…).
fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= 17
        && bytes.len() <= 21
        && bytes[..17]
            .iter()
            .enumerate()
            .all(|(index, byte)| match index {
                4 | 7 | 10 => *byte == b'-',
                _ => byte.is_ascii_digit(),
            })
        && (bytes.len() == 17 || (bytes[17] == b'-' && bytes[18..].iter().all(u8::is_ascii_digit)))
}

fn copy_tree(key: &MasterKey, from: &Path, to: &Path) -> Result<usize, BackupError> {
    let mut count = 0;
    for source in files::list_files(from)? {
        let relative = source
            .strip_prefix(from)
            .map_err(|_| BackupError::Invalid("Chemin de document inattendu.".into()))?;
        let target = to.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        if files::is_encrypted_file(&source)? {
            fs::copy(&source, &target)?;
        } else {
            // Ne devrait pas arriver (tout est chiffré au déverrouillage) : on
            // chiffre quand même plutôt que de copier un fichier en clair.
            files::encrypt_file_to(key, &source, &target)?;
        }
        count += 1;
    }
    Ok(count)
}

fn dir_size(path: &Path) -> u64 {
    files::list_files(path)
        .unwrap_or_default()
        .iter()
        .filter_map(|file| fs::metadata(file).ok())
        .map(|metadata| metadata.len())
        .sum()
}

/// Crée une sauvegarde complète et renvoie son entrée. Les plus anciennes au-delà
/// de `KEEP` sont supprimées.
pub async fn create(
    pool: &SqlitePool,
    key: &MasterKey,
    paths: &AppPaths,
    folder: &Path,
    app_version: &str,
    fingerprint: String,
) -> Result<BackupEntry, BackupError> {
    let root = backups_root(folder)?;
    fs::create_dir_all(&root)?;
    remove_partials(&root);

    let now = chrono::Local::now();
    let mut name = now.format("%Y-%m-%d-%H%M%S").to_string();
    let mut index = 2;
    while root.join(&name).exists() {
        name = format!("{}-{index}", now.format("%Y-%m-%d-%H%M%S"));
        index += 1;
    }
    let partial = root.join(format!(".{name}.partial"));
    fs::create_dir_all(&partial)?;

    let result = async {
        let database_copy = partial.join("database.sqlite");
        let target = database_copy
            .to_str()
            .ok_or_else(|| BackupError::Invalid("Chemin de sauvegarde illisible.".into()))?
            .to_string();
        sqlx::query("VACUUM INTO ?")
            .bind(target)
            .execute(pool)
            .await
            .map_err(|error| {
                eprintln!("sauvegarde : copie de la base ({error})");
                BackupError::Database("La base n'a pas pu être copiée.".into())
            })?;
        // La copie doit s'ouvrir avec la clé et être intègre.
        database::inspect_encrypted(&database_copy, key).await?;

        let documents = copy_tree(key, &paths.documents, &partial.join("documents"))?;
        let photos = copy_tree(key, &paths.photos, &partial.join("photos"))?;
        fs::copy(&paths.vault, partial.join("vault.json"))?;

        let migration = database::applied_migrations(pool)
            .await
            .into_iter()
            .max()
            .unwrap_or(0);
        let manifest = Manifest {
            app: "Tracink".into(),
            format: MANIFEST_FORMAT,
            app_version: app_version.into(),
            created_at: now.to_rfc3339(),
            fingerprint,
            migration,
            documents,
            photos,
        };
        let text = serde_json::to_string_pretty(&manifest)
            .map_err(|_| BackupError::Invalid("Manifeste illisible.".into()))?;
        fs::write(partial.join("manifest.json"), text)?;
        Ok::<_, BackupError>(())
    }
    .await;

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&partial);
        return Err(error);
    }
    fs::rename(&partial, root.join(&name))?;
    prune(&root, KEEP)?;
    Ok(entry(&root, &name))
}

fn remove_partials(root: &Path) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') && name.ends_with(".partial") {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn backup_names(root: &Path) -> Result<Vec<String>, BackupError> {
    let mut names = Vec::new();
    if !root.exists() {
        return Ok(names);
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.file_type()?.is_dir() && valid_name(&name) {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

fn prune(root: &Path, keep: usize) -> Result<(), BackupError> {
    let names = backup_names(root)?;
    let overflow = names.len().saturating_sub(keep);
    for name in names.into_iter().take(overflow) {
        fs::remove_dir_all(root.join(name))?;
    }
    Ok(())
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    let text = fs::read_to_string(dir.join("manifest.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn entry(root: &Path, name: &str) -> BackupEntry {
    let dir = root.join(name);
    let manifest = read_manifest(&dir);
    BackupEntry {
        name: name.to_string(),
        created_at: manifest.as_ref().map(|m| m.created_at.clone()),
        app_version: manifest.as_ref().map(|m| m.app_version.clone()),
        documents: manifest.as_ref().map_or(0, |m| m.documents),
        size_bytes: dir_size(&dir),
        readable: manifest.is_some()
            && dir.join("database.sqlite").is_file()
            && dir.join("vault.json").is_file(),
    }
}

/// Sauvegardes du dossier, la plus récente en premier.
pub fn list(folder: &Path) -> Result<Vec<BackupEntry>, BackupError> {
    let root = backups_root(folder)?;
    let mut entries: Vec<BackupEntry> = backup_names(&root)?
        .iter()
        .map(|name| entry(&root, name))
        .collect();
    entries.reverse();
    Ok(entries)
}

pub enum Secret<'a> {
    Password(&'a str),
    RecoveryKey(&'a str),
}

/// Sauvegarde ouverte et vérifiée, prête à remplacer les données actuelles.
pub struct VerifiedBackup {
    dir: PathBuf,
    pub key: MasterKey,
}

/// Ouvre une sauvegarde avec son mot de passe (celui en vigueur au moment de la
/// sauvegarde) ou la clé de secours, et vérifie tout son contenu.
pub async fn verify(
    folder: &Path,
    name: &str,
    secret: Secret<'_>,
) -> Result<VerifiedBackup, BackupError> {
    if !valid_name(name) {
        return Err(BackupError::Invalid("Sauvegarde inconnue.".into()));
    }
    let dir = backups_root(folder)?.join(name);
    let manifest = read_manifest(&dir).ok_or_else(|| {
        BackupError::Invalid("Cette sauvegarde est incomplète (manifeste absent).".into())
    })?;
    if manifest.format > MANIFEST_FORMAT || manifest.migration > database::latest_known_migration()
    {
        return Err(BackupError::Invalid(
            "Cette sauvegarde vient d'une version plus récente de Tracink. Mettez l'app à jour avant de la restaurer."
                .into(),
        ));
    }

    let vault = Vault::load(&dir.join("vault.json"))?;
    let key = tauri::async_runtime::spawn_blocking({
        let vault = vault.clone();
        let secret = match secret {
            Secret::Password(text) => (true, zeroize::Zeroizing::new(text.to_string())),
            Secret::RecoveryKey(text) => (false, zeroize::Zeroizing::new(text.to_string())),
        };
        move || {
            if secret.0 {
                vault.unlock_with_password(&secret.1).map_err(|error| match error {
                    VaultError::WrongSecret => VaultError::Invalid(
                        "Mot de passe incorrect pour cette sauvegarde (celui en vigueur à sa date).",
                    ),
                    other => other,
                })
            } else {
                vault.unlock_with_recovery(&secret.1)
            }
        }
    })
    .await
    .map_err(|_| BackupError::Invalid("Vérification interrompue.".into()))??;

    database::inspect_encrypted(&dir.join("database.sqlite"), &key).await?;
    for folder_name in ["documents", "photos"] {
        for file in files::list_files(&dir.join(folder_name))? {
            files::decrypt_file(&key, &file).map_err(|_| {
                BackupError::Invalid(
                    "Un document de cette sauvegarde est abîmé : restauration refusée.".into(),
                )
            })?;
        }
    }
    Ok(VerifiedBackup { dir, key })
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for file in files::list_files(from)? {
        let relative = file
            .strip_prefix(from)
            .map_err(|_| io::Error::other("chemin inattendu"))?;
        let target = to.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&file, &target)?;
    }
    Ok(())
}

fn move_if_exists(from: &Path, to: &Path) -> io::Result<()> {
    if from.exists() {
        fs::rename(from, to)?;
    }
    Ok(())
}

/// Remplace les données actuelles par la sauvegarde. La base doit être fermée.
///
/// Les données actuelles ne sont pas supprimées : elles sont déplacées dans
/// `avant-restauration-<horodatage>/` à la racine des données de l'app. En cas
/// d'échec pendant la copie, elles sont remises en place.
pub fn replace_current_data(
    paths: &AppPaths,
    backup: &VerifiedBackup,
) -> Result<PathBuf, BackupError> {
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let aside = paths.root.join(format!("avant-restauration-{stamp}"));
    fs::create_dir_all(&aside)?;

    let moves: [(&Path, PathBuf); 4] = [
        (&paths.database, aside.join("database.sqlite")),
        (&paths.vault, aside.join("vault.json")),
        (&paths.documents, aside.join("documents")),
        (&paths.photos, aside.join("photos")),
    ];
    for (current, target) in &moves {
        if *current == paths.database.as_path() {
            if current.exists() {
                database::move_with_sidecars(current, target)?;
            }
        } else {
            move_if_exists(current, target)?;
        }
    }

    let copied = (|| {
        fs::copy(backup.dir.join("database.sqlite"), &paths.database)?;
        copy_dir(&backup.dir.join("documents"), &paths.documents)?;
        copy_dir(&backup.dir.join("photos"), &paths.photos)?;
        // Le coffre en dernier : tant qu'il manque, l'app ne croit pas la copie finie.
        fs::copy(backup.dir.join("vault.json"), &paths.vault)?;
        Ok::<_, io::Error>(())
    })();

    if let Err(error) = copied {
        // Remise en place des données d'avant.
        let _ = database::remove_with_sidecars(&paths.database);
        let _ = fs::remove_file(&paths.vault);
        let _ = fs::remove_dir_all(&paths.documents);
        let _ = fs::remove_dir_all(&paths.photos);
        for (current, target) in &moves {
            if *current == paths.database.as_path() {
                if target.exists() {
                    let _ = database::move_with_sidecars(target, current);
                }
            } else {
                let _ = move_if_exists(target, current);
            }
        }
        return Err(error.into());
    }
    Ok(aside)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names_are_timestamps_only() {
        assert!(valid_name("2026-10-15-143000"));
        assert!(valid_name("2026-10-15-143000-2"));
        assert!(!valid_name("../2026-10-15-14300"));
        assert!(!valid_name("2026-10-15-143000/.."));
        assert!(!valid_name(".2026-10-15-143000.partial"));
        assert!(!valid_name("avant-restauration"));
    }
}

//! Ouverture de la base chiffrée (SQLCipher) et état verrouillé / déverrouillé.
//!
//! Au démarrage, la base n'est pas ouverte : il faut la clé maître, obtenue par le
//! mot de passe, la clé de secours ou Touch ID. Les commandes demandent la base à
//! `Db`, qui répond « verrouillé » tant qu'elle est fermée.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{ConnectOptions, Connection, SqlitePool};

use crate::backup;
use crate::config::AppPaths;
use crate::security::files;
use crate::security::vault::MasterKey;

pub const LOCKED_MESSAGE: &str = "Tracink est verrouillé. Déverrouillez-le pour continuer.";
const SQLITE_HEADER: &[u8] = b"SQLite format 3\0";

pub struct Unlocked {
    pub pool: SqlitePool,
    pub key: MasterKey,
}

/// Base ouverte ou non. Géré par Tauri (`app.manage`).
#[derive(Default)]
pub struct Db {
    state: RwLock<Option<Unlocked>>,
    /// Sérialise déverrouillage, verrouillage, restauration et sauvegarde.
    pub operation: tauri::async_runtime::Mutex<()>,
}

impl Db {
    pub fn pool(&self) -> Result<SqlitePool, String> {
        let guard = self.state.read().map_err(|_| LOCKED_MESSAGE.to_string())?;
        guard
            .as_ref()
            .map(|unlocked| unlocked.pool.clone())
            .ok_or_else(|| LOCKED_MESSAGE.to_string())
    }

    pub fn key(&self) -> Result<MasterKey, String> {
        let guard = self.state.read().map_err(|_| LOCKED_MESSAGE.to_string())?;
        guard
            .as_ref()
            .map(|unlocked| unlocked.key.clone())
            .ok_or_else(|| LOCKED_MESSAGE.to_string())
    }

    pub fn is_unlocked(&self) -> bool {
        self.state
            .read()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub fn set(&self, unlocked: Unlocked) {
        if let Ok(mut guard) = self.state.write() {
            *guard = Some(unlocked);
        }
    }

    pub fn take(&self) -> Option<Unlocked> {
        self.state.write().ok().and_then(|mut guard| guard.take())
    }
}

#[derive(Debug)]
pub enum OpenError {
    /// La clé n'ouvre pas la base (ex. coffre et base ne correspondent pas).
    WrongKey,
    Failed(String),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongKey => write!(
                f,
                "La clé ne correspond pas à la base de données. Restaurez une sauvegarde complète."
            ),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for OpenError {}

fn failed(context: &str, error: impl std::fmt::Display) -> OpenError {
    // Ni chemin ni donnée : seulement l'étape et l'erreur technique.
    eprintln!("base : {context} ({error})");
    OpenError::Failed(format!(
        "Tracink n'a pas pu ouvrir ses données ({context})."
    ))
}

pub fn is_plaintext_sqlite(path: &Path) -> io::Result<bool> {
    use std::io::Read;
    let mut head = [0_u8; 16];
    let mut file = fs::File::open(path)?;
    let mut filled = 0;
    while filled < head.len() {
        match file.read(&mut head[filled..])? {
            0 => break,
            read => filled += read,
        }
    }
    Ok(filled == 16 && head == SQLITE_HEADER)
}

fn options(path: &Path, key: Option<&MasterKey>) -> SqliteConnectOptions {
    let mut options = SqliteConnectOptions::new()
        .filename(path)
        .foreign_keys(true);
    if let Some(key) = key {
        // sqlx envoie ce PRAGMA en premier, avant toute lecture de la base.
        options = options.pragma("key", key.sqlcipher_key().to_string());
    }
    options
}

fn classify(error: &sqlx::Error) -> OpenError {
    let text = error.to_string();
    if text.contains("file is not a database") || text.contains("code: 26") {
        OpenError::WrongKey
    } else {
        failed("connexion", text)
    }
}

/// Ouvre un pool sur une base chiffrée et vérifie que la clé est la bonne.
pub async fn connect_encrypted(
    path: &Path,
    key: &MasterKey,
    create: bool,
) -> Result<SqlitePool, OpenError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options(path, Some(key)).create_if_missing(create))
        .await
        .map_err(|error| classify(&error))?;
    if let Err(error) = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sqlite_master")
        .fetch_one(&pool)
        .await
    {
        pool.close().await;
        return Err(classify(&error));
    }
    Ok(pool)
}

/// Vérifie qu'une base s'ouvre avec la clé et qu'elle est intègre ; compte ses lignes.
pub async fn inspect_encrypted(
    path: &Path,
    key: &MasterKey,
) -> Result<Vec<(String, i64)>, OpenError> {
    let mut conn = options(path, Some(key))
        .read_only(true)
        .connect()
        .await
        .map_err(|error| classify(&error))?;
    let result = async {
        let check: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&mut conn)
            .await
            .map_err(|error| classify(&error))?;
        if check != "ok" {
            return Err(failed("contrôle d'intégrité", check));
        }
        table_counts(&mut conn).await
    }
    .await;
    let _ = conn.close().await;
    result
}

async fn table_counts(conn: &mut sqlx::SqliteConnection) -> Result<Vec<(String, i64)>, OpenError> {
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|error| classify(&error))?;
    let mut counts = Vec::with_capacity(tables.len());
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM \"{quoted}\""))
            .fetch_one(&mut *conn)
            .await
            .map_err(|error| failed("comptage", error))?;
        counts.push((table, count));
    }
    Ok(counts)
}

/// Copie chiffrée d'une base en clair, vérifiée table par table avant d'être gardée.
pub async fn export_encrypted(
    plain: &Path,
    destination: &Path,
    key: &MasterKey,
) -> Result<(), OpenError> {
    export_with_key(plain, None, destination, key).await
}

/// Copie d'une base vers `destination`, chiffrée avec `key`. La source est en clair
/// (`source_key` vide) ou chiffrée avec `source_key` (rotation de la clé maître).
/// La copie est vérifiée table par table avant d'être gardée.
pub async fn export_with_key(
    plain: &Path,
    source_key: Option<&MasterKey>,
    destination: &Path,
    key: &MasterKey,
) -> Result<(), OpenError> {
    remove_with_sidecars(destination).map_err(|error| failed("préparation", error))?;
    let target = destination
        .to_str()
        .ok_or_else(|| failed("chemin", "chemin non UTF-8"))?
        .to_string();

    // L'ATTACH hérite des droits d'ouverture : il faut celui de créer un fichier.
    let mut conn = options(plain, source_key)
        .create_if_missing(true)
        .connect()
        .await
        .map_err(|error| failed("lecture de l'ancienne base", error))?;
    let result = async {
        let before = table_counts(&mut conn).await?;
        // La clé n'est faite que de chiffres hexadécimaux : pas d'injection possible.
        let attach = format!(
            "ATTACH DATABASE ? AS encrypted KEY \"x'{}'\"",
            key.to_hex().as_str()
        );
        sqlx::query(&attach)
            .bind(target)
            .execute(&mut conn)
            .await
            .map_err(|error| failed("chiffrement", error))?;
        let exported = sqlx::query("SELECT sqlcipher_export('encrypted')")
            .execute(&mut conn)
            .await;
        let _ = sqlx::query("DETACH DATABASE encrypted")
            .execute(&mut conn)
            .await;
        exported.map_err(|error| failed("chiffrement", error))?;
        Ok::<_, OpenError>(before)
    }
    .await;
    let _ = conn.close().await;
    let before = result?;

    let after = inspect_encrypted(destination, key).await?;
    if after != before {
        let _ = remove_with_sidecars(destination);
        return Err(failed(
            "vérification de la copie chiffrée",
            "nombres de lignes différents",
        ));
    }
    Ok(())
}

fn sidecars(path: &Path) -> [PathBuf; 3] {
    let with = |suffix: &str| {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        PathBuf::from(name)
    };
    [with("-wal"), with("-shm"), with("-journal")]
}

pub fn remove_with_sidecars(path: &Path) -> io::Result<()> {
    for file in std::iter::once(path.to_path_buf()).chain(sidecars(path)) {
        match fs::remove_file(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// Déplace une base et ses fichiers `-wal` / `-shm`.
pub fn move_with_sidecars(from: &Path, to: &Path) -> io::Result<()> {
    remove_with_sidecars(to)?;
    fs::rename(from, to)?;
    for (source, target) in sidecars(from).into_iter().zip(sidecars(to)) {
        if source.exists() {
            fs::rename(source, target)?;
        }
    }
    Ok(())
}

/// Chiffre la base en clair d'une version précédente, ou reprend une conversion
/// interrompue. Sans effet si la base est déjà chiffrée.
///
/// Étapes : copie chiffrée vérifiée → l'ancienne base devient `database.plaintext`
/// → la copie prend sa place → l'ancienne est supprimée. Une coupure à n'importe
/// quelle étape laisse un état que le déverrouillage suivant sait reprendre.
pub async fn convert_plaintext_database(
    root: &Path,
    database: &Path,
    key: &MasterKey,
) -> Result<bool, OpenError> {
    let encrypting = root.join("database.encrypting");
    let plaintext = root.join("database.plaintext");

    // Coupure entre les deux renommages : la copie chiffrée est complète et vérifiée.
    if !database.exists() && encrypting.exists() {
        move_with_sidecars(&encrypting, database).map_err(|error| failed("reprise", error))?;
    }
    if !database.exists() && plaintext.exists() {
        move_with_sidecars(&plaintext, database).map_err(|error| failed("reprise", error))?;
    }

    let mut converted = false;
    if database.exists()
        && is_plaintext_sqlite(database).map_err(|error| failed("lecture", error))?
    {
        export_encrypted(database, &encrypting, key).await?;
        move_with_sidecars(database, &plaintext).map_err(|error| failed("remplacement", error))?;
        move_with_sidecars(&encrypting, database).map_err(|error| failed("remplacement", error))?;
        converted = true;
    }

    remove_with_sidecars(&plaintext).map_err(|error| failed("nettoyage", error))?;
    remove_with_sidecars(&encrypting).map_err(|error| failed("nettoyage", error))?;
    Ok(converted)
}

/// Chiffre les copies automatiques laissées en clair par une version précédente.
pub async fn encrypt_local_backups(backups: &Path, key: &MasterKey) -> Result<usize, OpenError> {
    let mut count = 0;
    let Ok(entries) = fs::read_dir(backups) else {
        return Ok(0);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_database = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("database-") && name.ends_with(".sqlite"));
        if !is_database || !is_plaintext_sqlite(&path).unwrap_or(false) {
            continue;
        }
        let tmp = path.with_extension("encrypting");
        export_encrypted(&path, &tmp, key).await?;
        fs::rename(&tmp, &path).map_err(|error| failed("copie automatique", error))?;
        count += 1;
    }
    Ok(count)
}

/// Ouvre la base avec la clé : conversion si besoin, copie de précaution, migrations.
pub async fn open(
    paths: &AppPaths,
    key: &MasterKey,
    version: &str,
) -> Result<SqlitePool, OpenError> {
    convert_plaintext_database(&paths.root, &paths.database, key).await?;
    files::encrypt_tree(key, &paths.documents).map_err(|error| failed("documents", error))?;
    files::encrypt_tree(key, &paths.photos).map_err(|error| failed("photos", error))?;
    encrypt_local_backups(&paths.backups, key).await?;

    let existed = paths.database.exists();
    let pool = connect_encrypted(&paths.database, key, true).await?;

    let pending = has_pending_migrations(&pool).await;
    if existed && (pending || backup::snapshot_due(&paths.backups)) {
        let refused = backup::snapshot_database(&pool, &paths.backups, version)
            .await
            .err()
            .map(|err| backup::backup_refused_message(&*err));
        if let Some(message) = refused {
            pool.close().await;
            return Err(OpenError::Failed(message));
        }
    }

    if let Err(err) = sqlx::migrate!("./migrations").run(&pool).await {
        let latest = backup::latest_backup(&paths.backups, "database", "sqlite")
            .ok()
            .flatten();
        pool.close().await;
        return Err(OpenError::Failed(backup::migration_failed_message(
            latest.as_deref(),
            &err,
        )));
    }
    Ok(pool)
}

/// Versions de migration déjà appliquées (vide pour une base neuve).
pub async fn applied_migrations(pool: &SqlitePool) -> Vec<i64> {
    sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success = 1")
        .fetch_all(pool)
        .await
        .unwrap_or_default()
}

async fn has_pending_migrations(pool: &SqlitePool) -> bool {
    let applied = applied_migrations(pool).await;
    sqlx::migrate!("./migrations")
        .iter()
        .any(|migration| !applied.contains(&migration.version))
}

/// Version de migration la plus récente connue de cette version de l'app.
pub fn latest_known_migration() -> i64 {
    sqlx::migrate!("./migrations")
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;

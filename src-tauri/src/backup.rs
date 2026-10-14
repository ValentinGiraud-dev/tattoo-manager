use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use sqlx::SqlitePool;

const KEEP: usize = 10;

pub fn backup_refused_message(err: &dyn std::fmt::Display) -> String {
    format!(
        "Tracink n’a pas pu copier ses données avant la mise à jour.\n\nAucune modification de la base n’a été lancée.\n\n{err}"
    )
}

pub fn migration_failed_message(backup: Option<&Path>, err: &dyn std::fmt::Display) -> String {
    let copy = match backup {
        Some(path) => format!("Dernière copie : {}", path.display()),
        None => "Aucune copie précédente n’existe encore.".to_string(),
    };
    format!(
        "Tracink n’a pas pu mettre à jour ses données.\n\nLa base n’a pas été modifiée.\n{copy}\n\n{err}"
    )
}

pub fn copy_if_changed(
    source: &Path,
    backups: &Path,
    prefix: &str,
    extension: &str,
    version: &str,
) -> Result<Option<PathBuf>, Box<dyn std::error::Error>> {
    if !source.exists() {
        return Ok(None);
    }

    if let Some(latest) = latest_backup(backups, prefix, extension)? {
        if same_contents(source, &latest)? {
            return Ok(Some(latest));
        }
    }

    let destination = unique_destination(backups, prefix, &local_stamp(), version, extension);
    fs::copy(source, &destination)?;
    prune_backups(backups, prefix, extension, KEEP)?;
    Ok(Some(destination))
}

/// Copie cohérente de la base ouverte, faite par SQLite lui-même (`VACUUM INTO`).
///
/// Une copie de fichier ne suffit pas : en mode WAL, les dernières écritures peuvent
/// être dans `database.sqlite-wal`. Si le contenu est identique à la dernière copie,
/// aucune nouvelle copie n'est gardée.
pub async fn snapshot_database(
    pool: &SqlitePool,
    backups: &Path,
    version: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let pending = backups.join(".database-pending.sqlite");
    if pending.exists() {
        fs::remove_file(&pending)?;
    }

    let target = pending
        .to_str()
        .ok_or("chemin de sauvegarde illisible")?
        .to_string();
    sqlx::query("VACUUM INTO ?")
        .bind(target)
        .execute(pool)
        .await?;

    if let Some(latest) = latest_backup(backups, "database", "sqlite")? {
        if same_contents(&pending, &latest)? {
            fs::remove_file(&pending)?;
            return Ok(latest);
        }
    }

    let destination = unique_destination(backups, "database", &local_stamp(), version, "sqlite");
    fs::rename(&pending, &destination)?;
    prune_backups(backups, "database", "sqlite", KEEP)?;
    Ok(destination)
}

pub fn latest_backup(
    backups: &Path,
    prefix: &str,
    extension: &str,
) -> Result<Option<PathBuf>, io::Error> {
    let mut matches = backup_files(backups, prefix, extension)?;
    matches.sort();
    Ok(matches.pop())
}

fn local_stamp() -> String {
    stamp_from(Local::now())
}

fn stamp_from(datetime: DateTime<Local>) -> String {
    datetime.format("%Y-%m-%d-%H%M%S").to_string()
}

fn unique_destination(
    backups: &Path,
    prefix: &str,
    stamp: &str,
    version: &str,
    extension: &str,
) -> PathBuf {
    let candidate = backups.join(format!("{prefix}-{stamp}-v{version}.{extension}"));
    if !candidate.exists() {
        return candidate;
    }

    let mut index = 2;
    loop {
        let candidate = backups.join(format!("{prefix}-{stamp}-v{version}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

fn prune_backups(backups: &Path, prefix: &str, extension: &str, keep: usize) -> io::Result<()> {
    let mut matches = backup_files(backups, prefix, extension)?;
    matches.sort();
    let overflow = matches.len().saturating_sub(keep);
    for path in matches.into_iter().take(overflow) {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn backup_files(backups: &Path, prefix: &str, extension: &str) -> io::Result<Vec<PathBuf>> {
    let prefix = format!("{prefix}-");
    let extension = format!(".{extension}");
    let mut matches = Vec::new();

    for entry in fs::read_dir(backups)? {
        let path = entry?.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with(&prefix) && name.ends_with(&extension) {
            matches.push(path);
        }
    }

    Ok(matches)
}

fn same_contents(left: &Path, right: &Path) -> io::Result<bool> {
    let mut left_file = File::open(left)?;
    let mut right_file = File::open(right)?;
    if left_file.metadata()?.len() != right_file.metadata()?.len() {
        return Ok(false);
    }

    let mut left_buf = [0_u8; 8192];
    let mut right_buf = [0_u8; 8192];
    loop {
        let left_read = read_chunk(&mut left_file, &mut left_buf)?;
        let right_read = read_chunk(&mut right_file, &mut right_buf)?;
        if left_read != right_read || left_buf[..left_read] != right_buf[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn read_chunk(file: &mut File, buf: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match file.read(&mut buf[filled..])? {
            0 => break,
            read => filled += read,
        }
    }
    Ok(filled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
    use std::time::SystemTime;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tracink-backup-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stamp_uses_local_date_and_time() {
        let datetime = Local
            .with_ymd_and_hms(2026, 10, 13, 14, 50, 3)
            .single()
            .unwrap();
        assert_eq!(stamp_from(datetime), "2026-10-13-145003");
    }

    #[test]
    fn copy_skips_identical_file_and_keeps_ten() {
        let dir = temp_dir();
        let source = dir.join("settings.json");
        fs::write(&source, "alpha").unwrap();
        let backups = dir.join("backups");
        fs::create_dir(&backups).unwrap();

        let first = copy_if_changed(&source, &backups, "settings", "json", "0.1.0")
            .unwrap()
            .unwrap();
        let second = copy_if_changed(&source, &backups, "settings", "json", "0.1.0")
            .unwrap()
            .unwrap();
        assert_eq!(first, second);

        for index in 0..12 {
            fs::write(&source, format!("version-{index}")).unwrap();
            copy_if_changed(&source, &backups, "settings", "json", "0.1.0").unwrap();
        }

        let saved = backup_files(&backups, "settings", "json").unwrap();
        assert_eq!(saved.len(), KEEP);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn opening_a_clean_database_does_not_change_its_bytes() {
        let dir = temp_dir();
        let database = dir.join("database.sqlite");
        tauri::async_runtime::block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(&database)
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.unwrap();
            sqlx::query("CREATE TABLE example (name TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO example (name) VALUES ('Ada')")
                .execute(&pool)
                .await
                .unwrap();
            pool.close().await;
        });

        let before = fs::read(&database).unwrap();
        tauri::async_runtime::block_on(async {
            let options = SqliteConnectOptions::new().filename(&database);
            let pool = SqlitePool::connect_with(options).await.unwrap();
            let name: String = sqlx::query_scalar("SELECT name FROM example")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(name, "Ada");
            pool.close().await;
        });
        assert_eq!(before, fs::read(&database).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_keeps_rows_and_skips_an_unchanged_database() {
        let dir = temp_dir();
        let backups = dir.join("backups");
        fs::create_dir(&backups).unwrap();
        let database = dir.join("database.sqlite");

        tauri::async_runtime::block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(&database)
                .create_if_missing(true);
            let pool = SqlitePool::connect_with(options).await.unwrap();
            sqlx::query("CREATE TABLE example (name TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO example (name) VALUES ('Ada')")
                .execute(&pool)
                .await
                .unwrap();
            pool.close().await;
        });

        let first = copy_if_changed(&database, &backups, "database", "sqlite", "0.1.0")
            .unwrap()
            .unwrap();
        let second = copy_if_changed(&database, &backups, "database", "sqlite", "0.1.0")
            .unwrap()
            .unwrap();
        assert_eq!(first, second);

        tauri::async_runtime::block_on(async {
            let backup = SqlitePool::connect_with(
                SqliteConnectOptions::new().filename(&first).read_only(true),
            )
            .await
            .unwrap();
            let name: String = sqlx::query_scalar("SELECT name FROM example")
                .fetch_one(&backup)
                .await
                .unwrap();
            assert_eq!(name, "Ada");
            backup.close().await;
        });

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_includes_writes_still_in_the_wal_and_skips_an_unchanged_base() {
        let dir = temp_dir();
        let backups = dir.join("backups");
        fs::create_dir(&backups).unwrap();
        let database = dir.join("database.sqlite");

        tauri::async_runtime::block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(&database)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal);
            let pool = SqlitePool::connect_with(options).await.unwrap();
            sqlx::query("PRAGMA wal_autocheckpoint = 0")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("CREATE TABLE example (name TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO example (name) VALUES ('Ada')")
                .execute(&pool)
                .await
                .unwrap();

            let first = snapshot_database(&pool, &backups, "0.1.0").await.unwrap();
            let second = snapshot_database(&pool, &backups, "0.1.0").await.unwrap();
            assert_eq!(first, second);
            assert!(!backups.join(".database-pending.sqlite").exists());

            sqlx::query("INSERT INTO example (name) VALUES ('Grace')")
                .execute(&pool)
                .await
                .unwrap();
            let third = snapshot_database(&pool, &backups, "0.1.0").await.unwrap();
            assert_ne!(first, third);
            pool.close().await;

            let copy = SqlitePool::connect_with(
                SqliteConnectOptions::new().filename(&third).read_only(true),
            )
            .await
            .unwrap();
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM example")
                .fetch_one(&copy)
                .await
                .unwrap();
            assert_eq!(count, 2);
            copy.close().await;
        });

        assert_eq!(
            backup_files(&backups, "database", "sqlite").unwrap().len(),
            2
        );
        let _ = fs::remove_dir_all(&dir);
    }
}

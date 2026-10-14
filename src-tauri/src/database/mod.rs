use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::backup;
use crate::config::AppPaths;

pub fn init(paths: &AppPaths, version: &str) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let existed = paths.database.exists();
    let options = SqliteConnectOptions::new()
        .filename(&paths.database)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        if existed {
            backup::copy_if_changed(
                &paths.database,
                &paths.backups,
                "database",
                "sqlite",
                version,
            )
            .map_err(|err| -> Box<dyn std::error::Error> {
                backup::backup_refused_message(&err).into()
            })?;
        }

        sqlx::migrate!("./migrations").run(&pool).await.map_err(
            |err| -> Box<dyn std::error::Error> {
                let backup = backup::latest_backup(&paths.backups, "database", "sqlite")
                    .ok()
                    .flatten();
                backup::migration_failed_message(backup.as_deref(), &err).into()
            },
        )?;

        Ok::<_, Box<dyn std::error::Error>>(pool)
    })?;

    eprintln!("base SQLite : {}", paths.database.display());
    Ok(pool)
}

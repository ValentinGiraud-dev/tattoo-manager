use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::config::AppPaths;

pub fn init(paths: &AppPaths) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let options = SqliteConnectOptions::new()
        .filename(&paths.database)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok::<_, Box<dyn std::error::Error>>(pool)
    })?;

    eprintln!("base SQLite : {}", paths.database.display());
    Ok(pool)
}

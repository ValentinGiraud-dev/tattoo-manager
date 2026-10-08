use sqlx::SqlitePool;
use tauri::State;

use crate::config::{AppPaths, AppPathsDto, AppSettings};
use crate::{config, services};

#[tauri::command]
pub async fn database_status(pool: State<'_, SqlitePool>) -> Result<i64, String> {
    services::applied_migration_count(pool.inner())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_app_paths(paths: State<'_, AppPaths>) -> AppPathsDto {
    paths.to_dto()
}

#[tauri::command]
pub fn get_settings(paths: State<'_, AppPaths>) -> Result<AppSettings, String> {
    config::load_settings(paths.inner()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_settings(
    paths: State<'_, AppPaths>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    config::save_settings(paths.inner(), &settings).map_err(|error| error.to_string())?;
    Ok(settings)
}

use sqlx::SqlitePool;
use tauri::State;

use crate::config::{AppPaths, AppPathsDto, AppSettings};
use crate::models::{Client, Product};
use crate::services::clients::{self, ClientInput};
use crate::services::products::{self, ProductInput};
use crate::services::session_products::{self, ProductSessionItem, SessionProductItem};
use crate::services::sessions::{self, SessionInput, SessionListItem};
use crate::{config, services};

#[tauri::command]
pub async fn database_status(pool: State<'_, SqlitePool>) -> Result<i64, String> {
    services::applied_migration_count(pool.inner())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_clients(
    pool: State<'_, SqlitePool>,
    search: Option<String>,
) -> Result<Vec<Client>, String> {
    clients::list_clients(pool.inner(), search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_client(pool: State<'_, SqlitePool>, id: String) -> Result<Client, String> {
    clients::get_client(pool.inner(), &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_client(
    pool: State<'_, SqlitePool>,
    input: ClientInput,
) -> Result<Client, String> {
    clients::create_client(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_client(
    pool: State<'_, SqlitePool>,
    id: String,
    input: ClientInput,
) -> Result<Client, String> {
    clients::update_client(pool.inner(), &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_sessions(
    pool: State<'_, SqlitePool>,
    search: Option<String>,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_sessions(pool.inner(), search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_session(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<SessionListItem, String> {
    sessions::get_session(pool.inner(), &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_session(
    pool: State<'_, SqlitePool>,
    input: SessionInput,
) -> Result<SessionListItem, String> {
    sessions::create_session(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_session(
    pool: State<'_, SqlitePool>,
    id: String,
    input: SessionInput,
) -> Result<SessionListItem, String> {
    sessions::update_session(pool.inner(), &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_products(
    pool: State<'_, SqlitePool>,
    search: Option<String>,
) -> Result<Vec<Product>, String> {
    products::list_products(pool.inner(), search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_product(pool: State<'_, SqlitePool>, id: String) -> Result<Product, String> {
    products::get_product(pool.inner(), &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_product(
    pool: State<'_, SqlitePool>,
    input: ProductInput,
) -> Result<Product, String> {
    products::create_product(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_product(
    pool: State<'_, SqlitePool>,
    id: String,
    input: ProductInput,
) -> Result<Product, String> {
    products::update_product(pool.inner(), &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_session_products(
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<Vec<SessionProductItem>, String> {
    session_products::list_session_products(pool.inner(), &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_product_sessions(
    pool: State<'_, SqlitePool>,
    product_id: String,
) -> Result<Vec<ProductSessionItem>, String> {
    session_products::list_product_sessions(pool.inner(), &product_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn link_session_product(
    pool: State<'_, SqlitePool>,
    session_id: String,
    product_id: String,
) -> Result<SessionProductItem, String> {
    session_products::link_session_product(pool.inner(), &session_id, &product_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_linkable_products(
    pool: State<'_, SqlitePool>,
    session_id: String,
    search: Option<String>,
) -> Result<Vec<Product>, String> {
    session_products::list_linkable_products(pool.inner(), &session_id, search)
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

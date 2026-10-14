use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::config::{AppPaths, AppPathsDto, AppSettings};
use crate::models::{Client, StockMovement};
use crate::services::clients::{self, ClientInput};
use crate::services::lots::{self, CreateLotInput, LotSummary, UpdateLotInput};
use crate::services::paperwork::{
    self, ConsentAnswers, DocumentKind, FormKind, HealthAnswers, Paperwork, SessionDocument,
};
use crate::services::session_usages::{
    self, LinkSessionInput, LinkableItem, LotSessionItem, SessionUsageItem, VoidUsageInput,
};
use crate::services::sessions::{self, SessionInput, SessionListItem};
use crate::services::stock::{self, RecordMovementInput};
use crate::services::units::{self, UnitView};
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
pub async fn list_lots(
    pool: State<'_, SqlitePool>,
    search: Option<String>,
) -> Result<Vec<LotSummary>, String> {
    lots::list_lots(pool.inner(), search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_lot(pool: State<'_, SqlitePool>, id: String) -> Result<LotSummary, String> {
    lots::get_lot(pool.inner(), &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn find_lot(
    pool: State<'_, SqlitePool>,
    name: String,
    lot_number: String,
) -> Result<Option<LotSummary>, String> {
    lots::find_lot(pool.inner(), &name, &lot_number)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_lot(
    pool: State<'_, SqlitePool>,
    input: CreateLotInput,
) -> Result<LotSummary, String> {
    lots::create_lot(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_lot(
    pool: State<'_, SqlitePool>,
    id: String,
    input: UpdateLotInput,
) -> Result<LotSummary, String> {
    lots::update_lot(pool.inner(), &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lot_units(
    pool: State<'_, SqlitePool>,
    lot_id: String,
) -> Result<Vec<UnitView>, String> {
    units::list_units(pool.inner(), &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_unit(
    pool: State<'_, SqlitePool>,
    unit_id: String,
    opened_at: String,
) -> Result<UnitView, String> {
    units::open_unit(pool.inner(), &unit_id, opened_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn exit_unit(
    pool: State<'_, SqlitePool>,
    unit_id: String,
    movement_type: String,
) -> Result<UnitView, String> {
    units::exit_unit(pool.inner(), &unit_id, &movement_type)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_lot_movement(
    pool: State<'_, SqlitePool>,
    input: RecordMovementInput,
) -> Result<LotSummary, String> {
    lots::record_movement(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn undo_lot_movement(
    pool: State<'_, SqlitePool>,
    movement_id: String,
) -> Result<LotSummary, String> {
    let lot_id = stock::undo_movement(pool.inner(), &movement_id)
        .await
        .map_err(|error| error.to_string())?;
    lots::get_lot(pool.inner(), &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lot_movements(
    pool: State<'_, SqlitePool>,
    lot_id: String,
) -> Result<Vec<StockMovement>, String> {
    stock::list_movements(pool.inner(), &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lot_sessions(
    pool: State<'_, SqlitePool>,
    lot_id: String,
) -> Result<Vec<LotSessionItem>, String> {
    session_usages::list_lot_sessions(pool.inner(), &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_session_usages(
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<Vec<SessionUsageItem>, String> {
    session_usages::list_session_usages(pool.inner(), &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_linkable_usages(
    pool: State<'_, SqlitePool>,
    session_id: String,
    search: Option<String>,
) -> Result<Vec<LinkableItem>, String> {
    session_usages::list_linkable(pool.inner(), &session_id, search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn link_session_usage(
    pool: State<'_, SqlitePool>,
    input: LinkSessionInput,
) -> Result<SessionUsageItem, String> {
    session_usages::link_session(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_client_sessions(
    pool: State<'_, SqlitePool>,
    client_id: String,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_client_sessions(pool.inner(), &client_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_client_usages(
    pool: State<'_, SqlitePool>,
    client_id: String,
) -> Result<Vec<SessionUsageItem>, String> {
    session_usages::list_client_usages(pool.inner(), &client_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn void_session_usage(
    pool: State<'_, SqlitePool>,
    input: VoidUsageInput,
) -> Result<SessionUsageItem, String> {
    session_usages::void_usage(pool.inner(), input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_session_paperwork(
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<Paperwork, String> {
    paperwork::get_paperwork(pool.inner(), &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_health_form(
    pool: State<'_, SqlitePool>,
    session_id: String,
    answers: HealthAnswers,
) -> Result<Paperwork, String> {
    paperwork::save_health(pool.inner(), &session_id, answers)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_consent_form(
    pool: State<'_, SqlitePool>,
    session_id: String,
    answers: ConsentAnswers,
) -> Result<Paperwork, String> {
    paperwork::save_consent(pool.inner(), &session_id, answers)
        .await
        .map_err(|error| error.to_string())
}

/// Ouvre un fichier avec l'application par défaut (Aperçu pour un PDF).
fn open_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            eprintln!("ouverture de fichier : {error}");
            "Le fichier n'a pas pu être ouvert. Il se trouve dans le dossier documents de l'app."
                .to_string()
        })
}

#[tauri::command]
pub async fn print_session_form(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    paths: State<'_, AppPaths>,
    session_id: String,
    kind: FormKind,
) -> Result<String, String> {
    let settings = config::load_settings(paths.inner()).unwrap_or_default();
    let path = paperwork::print_form(
        pool.inner(),
        &paths.documents,
        &settings.studio,
        &session_id,
        kind,
    )
    .await
    .map_err(|error| error.to_string())?;
    open_file(&app, &path)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn open_aftercare_sheet(app: AppHandle, paths: State<'_, AppPaths>) -> Result<(), String> {
    let path = paperwork::aftercare_sheet(&paths.documents).map_err(|error| error.to_string())?;
    open_file(&app, &path)
}

#[tauri::command]
pub async fn attach_session_document(
    pool: State<'_, SqlitePool>,
    paths: State<'_, AppPaths>,
    session_id: String,
    kind: DocumentKind,
    source_path: String,
) -> Result<SessionDocument, String> {
    paperwork::attach_document(
        pool.inner(),
        &paths.documents,
        &session_id,
        kind,
        &PathBuf::from(source_path),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_session_document(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    paths: State<'_, AppPaths>,
    document_id: String,
) -> Result<(), String> {
    let path = paperwork::document_path(pool.inner(), &paths.documents, &document_id)
        .await
        .map_err(|error| error.to_string())?;
    open_file(&app, &path)
}

#[tauri::command]
pub async fn void_session_document(
    pool: State<'_, SqlitePool>,
    document_id: String,
    reason: String,
) -> Result<SessionDocument, String> {
    paperwork::void_document(pool.inner(), &document_id, &reason)
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

mod security;

pub use security::*;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::config::{AppPaths, AppPathsDto, AppSettings};
use crate::database::Db;
use crate::models::{Client, StockMovement};
use crate::services::billing::{
    self, DepositInput, DepositView, PaymentInput, PaymentView, SessionBilling, SettleDepositInput,
};
use crate::services::clients::{self, ClientInput};
use crate::services::lots::{self, CreateLotInput, LotSummary, UpdateLotInput};
use crate::services::paperwork::{
    self, ConsentAnswers, DocumentKind, FormKind, HealthAnswers, Paperwork, SessionDocument,
};
use crate::services::projects::{self, ProjectInput, ProjectSummary};
use crate::services::session_usages::{
    self, LinkSessionInput, LinkableItem, LotSessionItem, SessionUsageItem, VoidUsageInput,
};
use crate::services::sessions::{self, SessionInput, SessionListItem};
use crate::services::stock::{self, RecordMovementInput};
use crate::services::units::{self, UnitView};
use crate::{config, services};

#[tauri::command]
pub async fn database_status(db: State<'_, Db>) -> Result<i64, String> {
    services::applied_migration_count(&db.pool()?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_clients(
    db: State<'_, Db>,
    search: Option<String>,
) -> Result<Vec<Client>, String> {
    clients::list_clients(&db.pool()?, search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_client(db: State<'_, Db>, id: String) -> Result<Client, String> {
    clients::get_client(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_client(db: State<'_, Db>, input: ClientInput) -> Result<Client, String> {
    clients::create_client(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_client(
    db: State<'_, Db>,
    id: String,
    input: ClientInput,
) -> Result<Client, String> {
    clients::update_client(&db.pool()?, &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_sessions(
    db: State<'_, Db>,
    search: Option<String>,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_sessions(&db.pool()?, search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_session(db: State<'_, Db>, id: String) -> Result<SessionListItem, String> {
    sessions::get_session(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_session(
    db: State<'_, Db>,
    input: SessionInput,
) -> Result<SessionListItem, String> {
    sessions::create_session(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_session(
    db: State<'_, Db>,
    id: String,
    input: SessionInput,
) -> Result<SessionListItem, String> {
    sessions::update_session(&db.pool()?, &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lots(
    db: State<'_, Db>,
    search: Option<String>,
) -> Result<Vec<LotSummary>, String> {
    lots::list_lots(&db.pool()?, search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_lot(db: State<'_, Db>, id: String) -> Result<LotSummary, String> {
    lots::get_lot(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn find_lot(
    db: State<'_, Db>,
    name: String,
    lot_number: String,
) -> Result<Option<LotSummary>, String> {
    lots::find_lot(&db.pool()?, &name, &lot_number)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_lot(db: State<'_, Db>, input: CreateLotInput) -> Result<LotSummary, String> {
    lots::create_lot(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_lot(
    db: State<'_, Db>,
    id: String,
    input: UpdateLotInput,
) -> Result<LotSummary, String> {
    lots::update_lot(&db.pool()?, &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lot_units(db: State<'_, Db>, lot_id: String) -> Result<Vec<UnitView>, String> {
    units::list_units(&db.pool()?, &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_unit(
    db: State<'_, Db>,
    unit_id: String,
    opened_at: String,
) -> Result<UnitView, String> {
    units::open_unit(&db.pool()?, &unit_id, opened_at)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn exit_unit(
    db: State<'_, Db>,
    unit_id: String,
    movement_type: String,
) -> Result<UnitView, String> {
    units::exit_unit(&db.pool()?, &unit_id, &movement_type)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_lot_movement(
    db: State<'_, Db>,
    input: RecordMovementInput,
) -> Result<LotSummary, String> {
    lots::record_movement(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn undo_lot_movement(
    db: State<'_, Db>,
    movement_id: String,
) -> Result<LotSummary, String> {
    let lot_id = stock::undo_movement(&db.pool()?, &movement_id)
        .await
        .map_err(|error| error.to_string())?;
    lots::get_lot(&db.pool()?, &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lot_movements(
    db: State<'_, Db>,
    lot_id: String,
) -> Result<Vec<StockMovement>, String> {
    stock::list_movements(&db.pool()?, &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lot_sessions(
    db: State<'_, Db>,
    lot_id: String,
) -> Result<Vec<LotSessionItem>, String> {
    session_usages::list_lot_sessions(&db.pool()?, &lot_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_session_usages(
    db: State<'_, Db>,
    session_id: String,
) -> Result<Vec<SessionUsageItem>, String> {
    session_usages::list_session_usages(&db.pool()?, &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_linkable_usages(
    db: State<'_, Db>,
    session_id: String,
    search: Option<String>,
) -> Result<Vec<LinkableItem>, String> {
    session_usages::list_linkable(&db.pool()?, &session_id, search)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn link_session_usage(
    db: State<'_, Db>,
    input: LinkSessionInput,
) -> Result<SessionUsageItem, String> {
    session_usages::link_session(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_client_sessions(
    db: State<'_, Db>,
    client_id: String,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_client_sessions(&db.pool()?, &client_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_client_usages(
    db: State<'_, Db>,
    client_id: String,
) -> Result<Vec<SessionUsageItem>, String> {
    session_usages::list_client_usages(&db.pool()?, &client_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn void_session_usage(
    db: State<'_, Db>,
    input: VoidUsageInput,
) -> Result<SessionUsageItem, String> {
    session_usages::void_usage(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_session_paperwork(
    db: State<'_, Db>,
    session_id: String,
) -> Result<Paperwork, String> {
    paperwork::get_paperwork(&db.pool()?, &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_health_form(
    db: State<'_, Db>,
    session_id: String,
    answers: HealthAnswers,
) -> Result<Paperwork, String> {
    paperwork::save_health(&db.pool()?, &session_id, answers)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_consent_form(
    db: State<'_, Db>,
    session_id: String,
    answers: ConsentAnswers,
) -> Result<Paperwork, String> {
    paperwork::save_consent(&db.pool()?, &session_id, answers)
        .await
        .map_err(|error| error.to_string())
}

/// Ouvre un fichier avec l'application par défaut (Aperçu pour un PDF).
fn open_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|_| {
            // Pas de chemin dans le journal : il peut contenir un nom de client.
            eprintln!("ouverture de fichier impossible");
            "Le fichier n'a pas pu être ouvert dans Aperçu.".to_string()
        })
}

#[tauri::command]
pub async fn print_session_form(
    app: AppHandle,
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    session_id: String,
    kind: FormKind,
) -> Result<String, String> {
    let settings = config::load_settings(paths.inner()).unwrap_or_default();
    let path = paperwork::print_form(
        &db.pool()?,
        &paths.opened,
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
    let path = paperwork::aftercare_sheet(&paths.opened).map_err(|error| error.to_string())?;
    open_file(&app, &path)
}

#[tauri::command]
pub async fn attach_session_document(
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    session_id: String,
    kind: DocumentKind,
    source_path: String,
) -> Result<SessionDocument, String> {
    paperwork::attach_document(
        &db.pool()?,
        &db.key()?,
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
    db: State<'_, Db>,
    paths: State<'_, AppPaths>,
    document_id: String,
) -> Result<(), String> {
    let path = paperwork::open_document(
        &db.pool()?,
        &db.key()?,
        &paths.documents,
        &paths.opened,
        &document_id,
    )
    .await
    .map_err(|error| error.to_string())?;
    open_file(&app, &path)
}

#[tauri::command]
pub async fn void_session_document(
    db: State<'_, Db>,
    document_id: String,
    reason: String,
) -> Result<SessionDocument, String> {
    paperwork::void_document(&db.pool()?, &document_id, &reason)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_sessions_between(
    db: State<'_, Db>,
    from: String,
    to: String,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_sessions_between(&db.pool()?, &from, &to)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn find_session_overlaps(
    db: State<'_, Db>,
    date: String,
    start_time: String,
    duration_minutes: i64,
    exclude_id: Option<String>,
) -> Result<Vec<SessionListItem>, String> {
    sessions::find_overlaps(
        &db.pool()?,
        &date,
        &start_time,
        duration_minutes,
        exclude_id.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_project_sessions(
    db: State<'_, Db>,
    project_id: String,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_project_sessions(&db.pool()?, &project_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_client_projects(
    db: State<'_, Db>,
    client_id: String,
) -> Result<Vec<ProjectSummary>, String> {
    projects::list_client_projects(&db.pool()?, &client_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_project(db: State<'_, Db>, id: String) -> Result<ProjectSummary, String> {
    projects::get_project(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_project(
    db: State<'_, Db>,
    input: ProjectInput,
) -> Result<ProjectSummary, String> {
    projects::create_project(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_project(
    db: State<'_, Db>,
    id: String,
    input: ProjectInput,
) -> Result<ProjectSummary, String> {
    projects::update_project(&db.pool()?, &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_project_deposits(
    db: State<'_, Db>,
    project_id: String,
) -> Result<Vec<DepositView>, String> {
    billing::list_project_deposits(&db.pool()?, &project_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_session_billing(
    db: State<'_, Db>,
    session_id: String,
) -> Result<SessionBilling, String> {
    billing::get_session_billing(&db.pool()?, &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_deposit(db: State<'_, Db>, input: DepositInput) -> Result<DepositView, String> {
    billing::record_deposit(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn void_deposit(
    db: State<'_, Db>,
    deposit_id: String,
    reason: String,
) -> Result<DepositView, String> {
    billing::void_deposit(&db.pool()?, &deposit_id, &reason)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_deposit(
    db: State<'_, Db>,
    deposit_id: String,
    session_id: String,
) -> Result<DepositView, String> {
    billing::apply_deposit(&db.pool()?, &deposit_id, &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn settle_deposit(
    db: State<'_, Db>,
    input: SettleDepositInput,
) -> Result<DepositView, String> {
    billing::settle_deposit(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn void_deposit_outcome(
    db: State<'_, Db>,
    outcome_id: String,
    reason: String,
) -> Result<DepositView, String> {
    billing::void_outcome(&db.pool()?, &outcome_id, &reason)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_payment(db: State<'_, Db>, input: PaymentInput) -> Result<PaymentView, String> {
    billing::record_payment(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn void_payment(
    db: State<'_, Db>,
    payment_id: String,
    reason: String,
) -> Result<PaymentView, String> {
    billing::void_payment(&db.pool()?, &payment_id, &reason)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_app_paths(paths: State<'_, AppPaths>) -> AppPathsDto {
    paths.to_dto()
}

#[tauri::command]
pub fn get_settings(paths: State<'_, AppPaths>) -> Result<AppSettings, String> {
    config::load_settings(paths.inner()).map_err(|error| {
        eprintln!("réglages : {error}");
        "Les réglages n'ont pas pu être lus.".to_string()
    })
}

#[tauri::command]
pub fn update_settings(
    paths: State<'_, AppPaths>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    // Sécurité et sauvegardes ont leurs propres commandes : on ne garde ici que
    // les réglages de l'écran, pour ne pas écraser une date de sauvegarde récente.
    config::modify_settings(paths.inner(), |current| {
        current.locale = settings.locale;
        current.window = settings.window;
        current.studio = settings.studio;
    })
    .map_err(|error| {
        eprintln!("réglages : {error}");
        "Les réglages n'ont pas pu être enregistrés.".to_string()
    })
}

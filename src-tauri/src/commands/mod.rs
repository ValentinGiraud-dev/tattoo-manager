mod security;

pub use security::*;

use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::config::{AppPaths, AppPathsDto, AppSettings};
use crate::database::Db;
use crate::models::{Client, StockMovement};
use crate::services::audit::{self, AuditPage, AuditQuery};
use crate::services::billing::{
    self, DepositInput, DepositView, PaymentInput, PaymentView, SessionBilling, SettleDepositInput,
};
use crate::services::categories::{self, CategoryInput, CategoryView, LowStockSetting};
use crate::services::client_archive;
use crate::services::clients::{self, ClientInput};
use crate::services::dashboard::{self, Dashboard, PeriodSummary};
use crate::services::exports::{self, ExportKind};
use crate::services::lots::{self, CreateLotInput, LotSummary, UpdateLotInput};
use crate::services::low_stock::{self, LowStockReport};
use crate::services::paperwork::{
    self, ConsentAnswers, DocumentKind, FormKind, HealthAnswers, Paperwork, SessionDocument,
};
use crate::services::product_sheets::{self, ProductSheetInput, ProductSheetView};
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
    archived: Option<bool>,
) -> Result<Vec<Client>, String> {
    clients::list_clients(&db.pool()?, search, archived.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_client_archive(
    db: State<'_, Db>,
    id: String,
) -> Result<client_archive::ArchivePreview, String> {
    client_archive::archive_preview(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_client(db: State<'_, Db>, id: String) -> Result<(), String> {
    client_archive::archive_client(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_client(db: State<'_, Db>, id: String) -> Result<(), String> {
    client_archive::restore_client(&db.pool()?, &id)
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
pub async fn delete_client(db: State<'_, Db>, id: String) -> Result<(), String> {
    clients::delete_client(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_session_removal(
    db: State<'_, Db>,
    id: String,
) -> Result<sessions::SessionRemoval, String> {
    sessions::removal_preview(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_session(db: State<'_, Db>, id: String) -> Result<(), String> {
    sessions::delete_session(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_session(db: State<'_, Db>, id: String) -> Result<(), String> {
    sessions::archive_session(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_session(db: State<'_, Db>, id: String) -> Result<(), String> {
    sessions::restore_session(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_project_removal(
    db: State<'_, Db>,
    id: String,
) -> Result<projects::ProjectRemoval, String> {
    projects::removal_preview(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_project(db: State<'_, Db>, id: String) -> Result<(), String> {
    projects::delete_project(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_project(db: State<'_, Db>, id: String) -> Result<(), String> {
    projects::archive_project(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_project(db: State<'_, Db>, id: String) -> Result<(), String> {
    projects::restore_project(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_sessions(
    db: State<'_, Db>,
    search: Option<String>,
    archived: Option<bool>,
) -> Result<Vec<SessionListItem>, String> {
    sessions::list_sessions(&db.pool()?, search, archived.unwrap_or(false))
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
pub async fn set_aftercare_explained(
    db: State<'_, Db>,
    id: String,
    explained: bool,
) -> Result<SessionListItem, String> {
    sessions::set_aftercare_explained(&db.pool()?, &id, explained)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_lots(
    db: State<'_, Db>,
    search: Option<String>,
    archived: Option<bool>,
) -> Result<Vec<LotSummary>, String> {
    lots::list_lots(&db.pool()?, search, archived)
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
pub async fn preview_lot_removal(
    db: State<'_, Db>,
    id: String,
) -> Result<lots::LotRemoval, String> {
    lots::removal_preview(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_lot(db: State<'_, Db>, id: String) -> Result<(), String> {
    lots::delete_lot(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_lot(db: State<'_, Db>, id: String) -> Result<(), String> {
    lots::archive_lot(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_lot(db: State<'_, Db>, id: String) -> Result<(), String> {
    lots::restore_lot(&db.pool()?, &id)
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
pub async fn list_categories(db: State<'_, Db>) -> Result<Vec<CategoryView>, String> {
    categories::list_categories(&db.pool()?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_category(
    db: State<'_, Db>,
    input: CategoryInput,
) -> Result<CategoryView, String> {
    categories::create_category(&db.pool()?, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_category(
    db: State<'_, Db>,
    id: String,
    input: CategoryInput,
) -> Result<CategoryView, String> {
    categories::update_category(&db.pool()?, &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_category(db: State<'_, Db>, id: String) -> Result<(), String> {
    categories::delete_category(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_product_sheets(
    db: State<'_, Db>,
    search: Option<String>,
    archived: Option<bool>,
) -> Result<Vec<ProductSheetView>, String> {
    product_sheets::list_sheets(&db.pool()?, search, archived)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_product_sheet(db: State<'_, Db>, id: String) -> Result<ProductSheetView, String> {
    product_sheets::get_sheet(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

/// Crée une fiche ; `attach_lot_ids` : lots existants à y rattacher en même temps.
#[tauri::command]
pub async fn create_product_sheet(
    db: State<'_, Db>,
    input: ProductSheetInput,
    attach_lot_ids: Vec<String>,
) -> Result<ProductSheetView, String> {
    product_sheets::create_sheet(&db.pool()?, input, attach_lot_ids)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_product_sheet(
    db: State<'_, Db>,
    id: String,
    input: ProductSheetInput,
) -> Result<ProductSheetView, String> {
    product_sheets::update_sheet(&db.pool()?, &id, input)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_product_sheet(db: State<'_, Db>, id: String) -> Result<(), String> {
    product_sheets::delete_sheet(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_sheet_removal(
    db: State<'_, Db>,
    id: String,
) -> Result<product_sheets::SheetRemoval, String> {
    product_sheets::removal_preview(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn archive_product_sheet(db: State<'_, Db>, id: String) -> Result<(), String> {
    product_sheets::archive_sheet(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_product_sheet(db: State<'_, Db>, id: String) -> Result<(), String> {
    product_sheets::restore_sheet(&db.pool()?, &id)
        .await
        .map_err(|error| error.to_string())
}

/// Rattache un lot à une fiche produit, ou le détache (`sheetId` vide).
#[tauri::command]
pub async fn set_lot_product_sheet(
    db: State<'_, Db>,
    lot_id: String,
    sheet_id: Option<String>,
) -> Result<LotSummary, String> {
    product_sheets::set_lot_sheet(&db.pool()?, &lot_id, sheet_id)
        .await
        .map_err(|error| error.to_string())
}

/// Seuil de stock bas d'une catégorie (`EACH` : chaque produit, `TOTAL` : la somme).
#[tauri::command]
pub async fn set_category_low_stock(
    db: State<'_, Db>,
    id: String,
    setting: LowStockSetting,
) -> Result<CategoryView, String> {
    categories::set_low_stock(&db.pool()?, &id, setting)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_low_stock_report(db: State<'_, Db>) -> Result<LowStockReport, String> {
    low_stock::report(&db.pool()?)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_audit_entries(db: State<'_, Db>, query: AuditQuery) -> Result<AuditPage, String> {
    audit::list_entries(&db.pool()?, query)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, String> {
    dashboard::get_dashboard(&db.pool()?, services::expiry::today())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_period_summary(
    db: State<'_, Db>,
    from: String,
    to: String,
) -> Result<PeriodSummary, String> {
    dashboard::period_summary(&db.pool()?, &from, &to)
        .await
        .map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub rows: usize,
}

/// Écrit un export CSV à l'endroit choisi dans le dialogue d'enregistrement.
/// Le fichier est en clair : l'écran le signale avant.
#[tauri::command]
pub async fn export_csv(
    db: State<'_, Db>,
    kind: ExportKind,
    from: String,
    to: String,
    path: String,
) -> Result<ExportResult, String> {
    let mut target = PathBuf::from(path);
    if !target.is_absolute() {
        return Err("Choisissez où enregistrer le fichier.".to_string());
    }
    if target.extension().and_then(|ext| ext.to_str()) != Some("csv") {
        target.set_extension("csv");
    }
    let pool = db.pool()?;
    let csv = exports::export(&pool, kind, &from, &to)
        .await
        .map_err(|error| error.to_string())?;
    std::fs::write(&target, csv.bytes()).map_err(|error| {
        eprintln!("export CSV : {}", error.kind());
        "Le fichier n'a pas pu être enregistré à cet endroit.".to_string()
    })?;
    // Les données sortent de la base chiffrée : on garde la trace de l'export.
    audit::record_event_after(
        &pool,
        audit::event::CSV_EXPORTED,
        serde_json::json!({ "kind": kind.code(), "from": from, "to": to, "rows": csv.rows }),
    )
    .await;
    Ok(ExportResult {
        path: target.display().to_string(),
        rows: csv.rows,
    })
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

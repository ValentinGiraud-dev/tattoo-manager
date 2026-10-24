//! Suppression seulement sans trace, archivage sinon, lecture seule ensuite.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::client_archive;
use super::clients::{self, ClientInput};
use super::lots::{self, CreateLotInput};
use super::product_sheets::{self, ProductSheetInput};
use super::projects::{self, ProjectInput, ProjectStatus};
use super::session_usages::{self, LinkSessionInput};
use super::sessions::{self, SessionInput};
use super::stock::RecordMovementInput;
use crate::models::SessionStatus;

async fn db() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .in_memory(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn client_input() -> ClientInput {
    ClientInput {
        first_name: "Léa".into(),
        last_name: "Martin".into(),
        birth_date: None,
        address: None,
        email: None,
        phone: None,
        notes: None,
    }
}

fn session_input(client_id: &str) -> SessionInput {
    SessionInput {
        client_id: client_id.into(),
        project_id: None,
        date: "2026-06-01".into(),
        start_time: None,
        duration_minutes: None,
        status: SessionStatus::Planned,
        price_cents: None,
        body_area: None,
        description: None,
        notes: None,
        title: None,
    }
}

fn lot_input() -> CreateLotInput {
    CreateLotInput {
        name: "Aiguille".into(),
        lot_number: "A-1".into(),
        creation_date: None,
        expiration_date: "2030-01-01".into(),
        single_use: true,
        after_opening_months: None,
        product_url: None,
        quantity: 5,
        category_id: None,
        product_id: None,
    }
}

#[tokio::test]
async fn empty_client_is_deleted_and_cannot_be_archived() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input()).await.unwrap();
    let preview = client_archive::archive_preview(&pool, &client.id)
        .await
        .unwrap();
    assert!(preview.can_delete);
    let error = client_archive::archive_client(&pool, &client.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("supprime-le"));
    clients::delete_client(&pool, &client.id).await.unwrap();
}

#[tokio::test]
async fn client_with_a_session_is_archived_and_stock_comes_back() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input()).await.unwrap();
    let session = sessions::create_session(&pool, session_input(&client.id))
        .await
        .unwrap();
    let lot = lots::create_lot(&pool, lot_input()).await.unwrap();
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session.id.clone(),
            lot_id: Some(lot.id.clone()),
            unit_id: None,
            quantity: Some(2),
        },
    )
    .await
    .unwrap();
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 3);

    let error = clients::delete_client(&pool, &client.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("ne peut pas être supprimé"));

    client_archive::archive_client(&pool, &client.id)
        .await
        .unwrap();
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 5);
    assert!(clients::list_clients(&pool, None, false)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        clients::list_clients(&pool, None, true)
            .await
            .unwrap()
            .len(),
        1
    );
    let error = clients::update_client(&pool, &client.id, client_input())
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("désarchivez"));

    client_archive::restore_client(&pool, &client.id)
        .await
        .unwrap();
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 3);
    assert_eq!(
        clients::list_clients(&pool, None, false)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn empty_session_is_deleted_and_a_linked_one_is_archived() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input()).await.unwrap();
    let empty = sessions::create_session(&pool, session_input(&client.id))
        .await
        .unwrap();
    let preview = sessions::removal_preview(&pool, &empty.id).await.unwrap();
    assert!(preview.can_delete);
    let error = sessions::archive_session(&pool, &empty.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("supprime-la"));
    sessions::delete_session(&pool, &empty.id).await.unwrap();

    let session = sessions::create_session(&pool, session_input(&client.id))
        .await
        .unwrap();
    let lot = lots::create_lot(&pool, lot_input()).await.unwrap();
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session.id.clone(),
            lot_id: Some(lot.id),
            unit_id: None,
            quantity: Some(1),
        },
    )
    .await
    .unwrap();
    let error = sessions::delete_session(&pool, &session.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("ne peut pas être supprimée"));
    sessions::archive_session(&pool, &session.id).await.unwrap();
    assert!(sessions::list_sessions(&pool, None, false)
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        sessions::list_client_sessions(&pool, &client.id)
            .await
            .unwrap()
            .len(),
        1
    );
    let error = sessions::update_session(&pool, &session.id, session_input(&client.id))
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("désarchivez"));
    sessions::restore_session(&pool, &session.id).await.unwrap();
    sessions::update_session(&pool, &session.id, session_input(&client.id))
        .await
        .unwrap();
}

#[tokio::test]
async fn project_follows_the_same_rule() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input()).await.unwrap();
    let project = projects::create_project(
        &pool,
        ProjectInput {
            client_id: client.id.clone(),
            title: "Dos".into(),
            body_area: None,
            description: None,
            quoted_price_cents: None,
            status: ProjectStatus::Active,
        },
    )
    .await
    .unwrap();
    assert!(
        projects::removal_preview(&pool, &project.id)
            .await
            .unwrap()
            .can_delete
    );
    projects::delete_project(&pool, &project.id).await.unwrap();

    let project = projects::create_project(
        &pool,
        ProjectInput {
            client_id: client.id.clone(),
            title: "Bras".into(),
            body_area: None,
            description: None,
            quoted_price_cents: None,
            status: ProjectStatus::Active,
        },
    )
    .await
    .unwrap();
    let mut input = session_input(&client.id);
    input.project_id = Some(project.id.clone());
    sessions::create_session(&pool, input).await.unwrap();
    let error = projects::delete_project(&pool, &project.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("ne peut pas être supprimé"));
    projects::archive_project(&pool, &project.id).await.unwrap();
    let error = projects::update_project(
        &pool,
        &project.id,
        ProjectInput {
            client_id: client.id,
            title: "Autre".into(),
            body_area: None,
            description: None,
            quoted_price_cents: None,
            status: ProjectStatus::Active,
        },
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("désarchivez"));
    projects::restore_project(&pool, &project.id).await.unwrap();
}

#[tokio::test]
async fn pristine_lot_is_deleted_and_a_touched_lot_is_archived() {
    let pool = db().await;
    let fresh = lots::create_lot(&pool, lot_input()).await.unwrap();
    assert!(
        lots::removal_preview(&pool, &fresh.id)
            .await
            .unwrap()
            .can_delete
    );
    let error = lots::archive_lot(&pool, &fresh.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("supprime-le"));
    lots::delete_lot(&pool, &fresh.id).await.unwrap();

    let lot = lots::create_lot(&pool, lot_input()).await.unwrap();
    lots::record_movement(
        &pool,
        RecordMovementInput {
            lot_id: lot.id.clone(),
            movement_type: "LOSS".into(),
            quantity: 1,
            reason: Some("cassé".into()),
        },
    )
    .await
    .unwrap();
    let error = lots::delete_lot(&pool, &lot.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("ne peut pas être supprimé"));
    lots::archive_lot(&pool, &lot.id).await.unwrap();
    assert!(lots::list_lots(&pool, None, Some(false))
        .await
        .unwrap()
        .is_empty());
    assert_eq!(
        lots::list_lots(&pool, None, Some(true))
            .await
            .unwrap()
            .len(),
        1
    );
    let error = lots::update_lot(
        &pool,
        &lot.id,
        super::lots::UpdateLotInput {
            name: "Aiguille".into(),
            lot_number: "A-1".into(),
            creation_date: None,
            expiration_date: "2031-01-01".into(),
            after_opening_months: None,
            product_url: None,
            category_id: None,
        },
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("désarchivez"));
    lots::restore_lot(&pool, &lot.id).await.unwrap();
}

#[tokio::test]
async fn sheet_without_lots_is_deleted_and_one_with_lots_is_archived() {
    let pool = db().await;
    let empty = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            name: "Gants".into(),
            brand: None,
            category_id: None,
            single_use: true,
            after_opening_months: None,
            product_url: None,
            low_stock_threshold: None,
        },
        Vec::new(),
    )
    .await
    .unwrap();
    product_sheets::delete_sheet(&pool, &empty.id)
        .await
        .unwrap();

    let sheet = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            name: "Encre".into(),
            brand: None,
            category_id: None,
            single_use: true,
            after_opening_months: None,
            product_url: None,
            low_stock_threshold: None,
        },
        Vec::new(),
    )
    .await
    .unwrap();
    let mut input = lot_input();
    input.product_id = Some(sheet.id.clone());
    lots::create_lot(&pool, input).await.unwrap();
    let error = product_sheets::delete_sheet(&pool, &sheet.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("ne peut pas être supprimée"));
    product_sheets::archive_sheet(&pool, &sheet.id)
        .await
        .unwrap();
    assert!(product_sheets::list_sheets(&pool, None, Some(false))
        .await
        .unwrap()
        .is_empty());
    let error = product_sheets::archive_sheet(&pool, &sheet.id)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("déjà archivée"));
    product_sheets::restore_sheet(&pool, &sheet.id)
        .await
        .unwrap();
}

#[tokio::test]
async fn archived_session_rejects_a_direct_update() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input()).await.unwrap();
    let session = sessions::create_session(&pool, session_input(&client.id))
        .await
        .unwrap();
    let lot = lots::create_lot(&pool, lot_input()).await.unwrap();
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session.id.clone(),
            lot_id: Some(lot.id),
            unit_id: None,
            quantity: Some(1),
        },
    )
    .await
    .unwrap();
    sessions::archive_session(&pool, &session.id).await.unwrap();
    let error = sqlx::query("UPDATE sessions SET notes = 'x' WHERE id = ?")
        .bind(&session.id)
        .execute(&pool)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("lecture seule"));
}

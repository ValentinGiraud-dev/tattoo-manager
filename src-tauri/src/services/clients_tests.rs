//! Suppression d'un client : permise sans historique, refusée sinon.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::clients::{self, ClientInput};
use super::sessions::{self, SessionInput};
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

fn input() -> ClientInput {
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

#[tokio::test]
async fn client_without_history_is_deleted() {
    let pool = db().await;
    let client = clients::create_client(&pool, input()).await.unwrap();
    clients::delete_client(&pool, &client.id).await.unwrap();
    assert!(clients::get_client(&pool, &client.id).await.is_err());
}

#[tokio::test]
async fn client_with_a_session_cannot_be_deleted() {
    let pool = db().await;
    let client = clients::create_client(&pool, input()).await.unwrap();
    sessions::create_session(
        &pool,
        SessionInput {
            client_id: client.id.clone(),
            project_id: None,
            date: "2026-10-05".into(),
            start_time: None,
            duration_minutes: None,
            status: SessionStatus::Completed,
            price_cents: None,
            body_area: None,
            description: None,
            notes: None,
            title: None,
        },
    )
    .await
    .unwrap();
    let error = clients::delete_client(&pool, &client.id).await.unwrap_err();
    assert!(error.to_string().contains("ne peut pas être supprimé"));
    assert!(clients::get_client(&pool, &client.id).await.is_ok());
}

#[tokio::test]
async fn deleting_an_unknown_client_is_refused() {
    let pool = db().await;
    assert!(matches!(
        clients::delete_client(&pool, "inconnu").await,
        Err(clients::ClientError::NotFound)
    ));
}

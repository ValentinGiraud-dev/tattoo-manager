//! Verrous de traçabilité : ce qui figure dans l'historique d'un client ne se réécrit pas.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::lots::{self, CreateLotInput, UpdateLotInput, LOT_IDENTITY_LOCKED};
use super::session_usages::{self, LinkSessionInput};
use super::sessions::{self, SessionInput, SESSION_CLIENT_LOCKED};
use super::units;
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
    for (id, first) in [("c1", "Léa"), ("c2", "Nina")] {
        sqlx::query(
            "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
             VALUES (?, ?, 'Martin', '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
        )
        .bind(id)
        .bind(first)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO sessions (id, client_id, date, status, created_at, updated_at)
         VALUES ('s1', 'c1', '2026-10-14', 'PLANNED', '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool
}

fn lot_input(expiration_date: &str, single_use: bool) -> CreateLotInput {
    CreateLotInput {
        name: if single_use {
            "Aiguille 3RL"
        } else {
            "Encre noire"
        }
        .into(),
        lot_number: "L-1".into(),
        creation_date: None,
        expiration_date: expiration_date.into(),
        single_use,
        after_opening_months: if single_use { None } else { Some(6) },
        product_url: None,
        quantity: 10,
        category_id: None,
        product_id: None,
    }
}

fn update_of(lot: &lots::LotSummary) -> UpdateLotInput {
    UpdateLotInput {
        name: lot.name.clone(),
        lot_number: lot.lot_number.clone(),
        creation_date: lot.creation_date.clone(),
        expiration_date: lot.expiration_date.clone(),
        after_opening_months: lot.after_opening_months,
        product_url: lot.product_url.clone(),
        category_id: None,
    }
}

fn session_for(client_id: &str) -> SessionInput {
    SessionInput {
        client_id: client_id.into(),
        project_id: None,
        date: "2026-10-14".into(),
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

async fn link_needles(pool: &SqlitePool, lot_id: &str) {
    session_usages::link_session(
        pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: Some(lot_id.into()),
            unit_id: None,
            quantity: Some(2),
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_session_without_products_can_change_client() {
    let pool = db().await;
    let session = sessions::update_session(&pool, "s1", session_for("c2"))
        .await
        .unwrap();
    assert_eq!(session.client_id, "c2");
}

#[tokio::test]
async fn a_session_with_linked_products_keeps_its_client() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    link_needles(&pool, &lot.id).await;

    let error = sessions::update_session(&pool, "s1", session_for("c2"))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), SESSION_CLIENT_LOCKED);

    // Le reste de la séance reste modifiable.
    let mut input = session_for("c1");
    input.notes = Some("Retouche prévue".into());
    let session = sessions::update_session(&pool, "s1", input).await.unwrap();
    assert_eq!(session.notes.as_deref(), Some("Retouche prévue"));
}

#[tokio::test]
async fn an_unused_lot_can_be_renamed() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    let mut input = update_of(&lot);
    input.lot_number = "L-2".into();
    input.expiration_date = "2031-01-01".into();
    let lot = lots::update_lot(&pool, &lot.id, input).await.unwrap();
    assert_eq!(lot.lot_number, "L-2");
    assert_eq!(lot.session_count, 0);
}

#[tokio::test]
async fn a_used_lot_keeps_its_identity_but_accepts_other_fields() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    link_needles(&pool, &lot.id).await;
    let lot = lots::get_lot(&pool, &lot.id).await.unwrap();
    assert_eq!(lot.session_count, 1);

    for change in [
        |input: &mut UpdateLotInput| input.name = "Aiguille 5RL".into(),
        |input: &mut UpdateLotInput| input.lot_number = "L-9".into(),
        |input: &mut UpdateLotInput| input.expiration_date = "2031-01-01".into(),
    ] {
        let mut input = update_of(&lot);
        change(&mut input);
        let error = lots::update_lot(&pool, &lot.id, input).await.unwrap_err();
        assert_eq!(error.to_string(), LOT_IDENTITY_LOCKED);
    }

    let mut input = update_of(&lot);
    input.product_url = Some("https://exemple.fr/aiguille".into());
    let updated = lots::update_lot(&pool, &lot.id, input).await.unwrap();
    assert_eq!(
        updated.product_url.as_deref(),
        Some("https://exemple.fr/aiguille")
    );
}

#[tokio::test]
async fn a_used_ink_keeps_its_after_opening_duration() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", false))
        .await
        .unwrap();
    let pieces = units::list_units(&pool, &lot.id).await.unwrap();
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: None,
            unit_id: Some(pieces[0].id.clone()),
            quantity: None,
        },
    )
    .await
    .unwrap();

    let mut input = update_of(&lot);
    input.after_opening_months = Some(12);
    let error = lots::update_lot(&pool, &lot.id, input).await.unwrap_err();
    assert_eq!(error.to_string(), LOT_IDENTITY_LOCKED);
}

#[tokio::test]
async fn an_opening_date_cannot_be_in_the_future() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", false))
        .await
        .unwrap();
    let piece = &units::list_units(&pool, &lot.id).await.unwrap()[0];
    let error = units::open_unit(&pool, &piece.id, "2999-01-01".into())
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "La date d'ouverture ne peut pas être dans le futur"
    );
}

#[tokio::test]
async fn a_used_piece_keeps_its_opening_date_once_set() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", false))
        .await
        .unwrap();
    let piece = units::list_units(&pool, &lot.id).await.unwrap()[0].clone();

    // Modifiable tant que la pièce n'a servi à aucune séance.
    units::open_unit(&pool, &piece.id, "2026-10-01".into())
        .await
        .unwrap();
    units::open_unit(&pool, &piece.id, "2026-10-02".into())
        .await
        .unwrap();

    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: None,
            unit_id: Some(piece.id.clone()),
            quantity: None,
        },
    )
    .await
    .unwrap();

    let error = units::open_unit(&pool, &piece.id, "2026-10-05".into())
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Cette pièce a déjà servi en séance : sa date d'ouverture ne peut plus changer"
    );
    // Renvoyer la même date n'est pas un changement.
    units::open_unit(&pool, &piece.id, "2026-10-02".into())
        .await
        .unwrap();
}

#[tokio::test]
async fn a_used_product_is_judged_expired_at_the_session_date() {
    let pool = db().await;
    // Périmé le 10 octobre, séance le 14 : périmé à la séance.
    let late = lots::create_lot(&pool, lot_input("2026-10-10", true))
        .await
        .unwrap();
    link_needles(&pool, &late.id).await;
    // Valable jusqu'au 14 inclus : pas périmé à la séance, même si on consulte plus tard.
    let mut fresh_input = lot_input("2026-10-14", true);
    fresh_input.lot_number = "L-OK".into();
    let fresh = lots::create_lot(&pool, fresh_input).await.unwrap();
    link_needles(&pool, &fresh.id).await;

    let usages = session_usages::list_session_usages(&pool, "s1")
        .await
        .unwrap();
    let expired = |lot_id: &str| {
        usages
            .iter()
            .find(|item| item.lot_id.as_deref() == Some(lot_id))
            .unwrap()
            .expired
    };
    assert!(expired(&late.id));
    assert!(!expired(&fresh.id));
}

fn void(usage_id: &str, reason: &str) -> session_usages::VoidUsageInput {
    session_usages::VoidUsageInput {
        usage_id: usage_id.into(),
        reason: reason.into(),
    }
}

#[tokio::test]
async fn voiding_a_single_use_link_returns_the_stock_and_keeps_the_link() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    link_needles(&pool, &lot.id).await;
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 8);

    let usage = &session_usages::list_session_usages(&pool, "s1")
        .await
        .unwrap()[0];
    let voided = session_usages::void_usage(&pool, void(&usage.id, "Mauvais lot scanné"))
        .await
        .unwrap();
    assert_eq!(voided.void_reason.as_deref(), Some("Mauvais lot scanné"));
    assert_eq!(voided.quantity, 0);
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 10);

    // Le lien reste dans l'historique de la séance et du lot.
    let usages = session_usages::list_session_usages(&pool, "s1")
        .await
        .unwrap();
    assert_eq!(usages.len(), 1);
    let lot_sessions = session_usages::list_lot_sessions(&pool, &lot.id)
        .await
        .unwrap();
    assert_eq!(lot_sessions.len(), 1);
    assert!(lot_sessions[0].void_reason.is_some());
}

#[tokio::test]
async fn voiding_needs_a_reason_and_happens_once() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    link_needles(&pool, &lot.id).await;
    let usage_id = session_usages::list_session_usages(&pool, "s1")
        .await
        .unwrap()[0]
        .id
        .clone();

    let error = session_usages::void_usage(&pool, void(&usage_id, "   "))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Le motif d'annulation est obligatoire");

    session_usages::void_usage(&pool, void(&usage_id, "Erreur"))
        .await
        .unwrap();
    let error = session_usages::void_usage(&pool, void(&usage_id, "Encore"))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Ce lien est déjà annulé");
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 10);
}

#[tokio::test]
async fn a_voided_link_cannot_be_linked_again_or_undone() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    link_needles(&pool, &lot.id).await;
    let usage_id = session_usages::list_session_usages(&pool, "s1")
        .await
        .unwrap()[0]
        .id
        .clone();
    session_usages::void_usage(&pool, void(&usage_id, "Erreur"))
        .await
        .unwrap();

    let error = session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: Some(lot.id.clone()),
            unit_id: None,
            quantity: Some(1),
        },
    )
    .await
    .unwrap_err();
    assert!(error
        .to_string()
        .starts_with("Ce produit a déjà été lié puis annulé"));

    let movements = super::stock::list_movements(&pool, &lot.id).await.unwrap();
    let void_adjustment = movements
        .iter()
        .find(|m| {
            m.reason
                .as_deref()
                .is_some_and(|r| r.starts_with("Annulation du lien"))
        })
        .unwrap();
    let error = super::stock::undo_movement(&pool, &void_adjustment.id)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("lien de séance annulé"));
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 10);
}

#[tokio::test]
async fn voiding_a_piece_link_does_not_touch_the_stock() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", false))
        .await
        .unwrap();
    let piece = units::list_units(&pool, &lot.id).await.unwrap()[0].clone();
    let usage = session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: None,
            unit_id: Some(piece.id.clone()),
            quantity: None,
        },
    )
    .await
    .unwrap();
    session_usages::void_usage(&pool, void(&usage.id, "Mauvaise couleur"))
        .await
        .unwrap();
    assert_eq!(lots::get_lot(&pool, &lot.id).await.unwrap().stock, 10);
}

#[tokio::test]
async fn a_client_history_lists_sessions_and_products_including_voided_links() {
    let pool = db().await;
    let lot = lots::create_lot(&pool, lot_input("2030-01-01", true))
        .await
        .unwrap();
    link_needles(&pool, &lot.id).await;
    let mut other = lot_input("2030-01-01", true);
    other.lot_number = "L-2".into();
    let other = lots::create_lot(&pool, other).await.unwrap();
    let usage = session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: Some(other.id.clone()),
            unit_id: None,
            quantity: Some(1),
        },
    )
    .await
    .unwrap();
    session_usages::void_usage(&pool, void(&usage.id, "Erreur"))
        .await
        .unwrap();

    let sessions = sessions::list_client_sessions(&pool, "c1").await.unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].usage_count, 2);
    let usages = session_usages::list_client_usages(&pool, "c1")
        .await
        .unwrap();
    assert_eq!(usages.len(), 2);
    assert_eq!(usages.iter().filter(|u| u.void_reason.is_some()).count(), 1);

    assert!(sessions::list_client_sessions(&pool, "c2")
        .await
        .unwrap()
        .is_empty());
    assert!(session_usages::list_client_usages(&pool, "c2")
        .await
        .unwrap()
        .is_empty());
}

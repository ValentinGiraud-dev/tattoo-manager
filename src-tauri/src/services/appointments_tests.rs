//! Rendez-vous, projets, acomptes et paiements.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::billing::{
    self, BillingState, DepositInput, DepositStatus, OutcomeKind, PaymentInput, PaymentMethod,
    SettleDepositInput,
};
use super::projects::{self, ProjectInput, ProjectStatus};
use super::sessions::{self, SessionInput, SESSION_CLIENT_LOCKED_MONEY};
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
             VALUES (?, ?, 'Martin', '2026-01-01T00:00:00', '2026-01-01T00:00:00')",
        )
        .bind(id)
        .bind(first)
        .execute(&pool)
        .await
        .unwrap();
    }
    pool
}

fn session(client_id: &str, date: &str, start: Option<&str>, minutes: Option<i64>) -> SessionInput {
    SessionInput {
        client_id: client_id.into(),
        project_id: None,
        date: date.into(),
        start_time: start.map(Into::into),
        duration_minutes: minutes,
        status: SessionStatus::Planned,
        price_cents: None,
        body_area: None,
        description: None,
        notes: None,
        title: None,
    }
}

fn project(client_id: &str) -> ProjectInput {
    ProjectInput {
        client_id: client_id.into(),
        title: "Manchette japonaise".into(),
        body_area: Some("Bras droit".into()),
        description: None,
        quoted_price_cents: Some(120_000),
        status: ProjectStatus::Active,
    }
}

fn deposit(project_id: Option<&str>, session_id: Option<&str>, cents: i64) -> DepositInput {
    DepositInput {
        project_id: project_id.map(Into::into),
        session_id: session_id.map(Into::into),
        amount_cents: cents,
        method: PaymentMethod::Transfer,
        received_on: "2026-09-01".into(),
        note: None,
    }
}

fn payment(session_id: &str, cents: i64) -> PaymentInput {
    PaymentInput {
        session_id: session_id.into(),
        amount_cents: cents,
        method: PaymentMethod::Card,
        paid_on: "2026-10-01".into(),
        note: None,
    }
}

#[tokio::test]
async fn a_session_keeps_time_duration_price_and_project() {
    let pool = db().await;
    let project = projects::create_project(&pool, project("c1"))
        .await
        .unwrap();
    let mut input = session("c1", "2026-10-20", Some("14:00"), Some(180));
    input.project_id = Some(project.id.clone());
    input.price_cents = Some(45_000);
    let saved = sessions::create_session(&pool, input).await.unwrap();
    assert_eq!(saved.start_time.as_deref(), Some("14:00"));
    assert_eq!(saved.duration_minutes, Some(180));
    assert_eq!(saved.price_cents, Some(45_000));
    assert_eq!(saved.project_title.as_deref(), Some("Manchette japonaise"));
}

#[tokio::test]
async fn invalid_times_durations_prices_and_projects_are_refused() {
    let pool = db().await;
    let other_project = projects::create_project(&pool, project("c2"))
        .await
        .unwrap();
    let cases: Vec<(SessionInput, &str)> = vec![
        (
            session("c1", "2026-10-20", Some("25:00"), None),
            "L'heure doit être au format HH:MM",
        ),
        (
            session("c1", "2026-10-20", None, Some(60)),
            "Indique l'heure de début pour une durée",
        ),
        (
            session("c1", "2026-10-20", Some("10:00"), Some(5)),
            "La durée doit être comprise entre 15 minutes et 12 heures",
        ),
        (
            SessionInput {
                price_cents: Some(-1),
                ..session("c1", "2026-10-20", None, None)
            },
            "Le prix n'est pas valide",
        ),
        (
            SessionInput {
                project_id: Some(other_project.id.clone()),
                ..session("c1", "2026-10-20", None, None)
            },
            "Le projet appartient à un autre client",
        ),
    ];
    for (input, message) in cases {
        let error = sessions::create_session(&pool, input).await.unwrap_err();
        assert_eq!(error.to_string(), message);
    }
}

#[tokio::test]
async fn overlapping_appointments_are_reported_not_blocked() {
    let pool = db().await;
    let first =
        sessions::create_session(&pool, session("c1", "2026-10-20", Some("14:00"), Some(120)))
            .await
            .unwrap();
    let mut cancelled = session("c2", "2026-10-20", Some("15:00"), Some(60));
    cancelled.status = SessionStatus::Cancelled;
    sessions::create_session(&pool, cancelled).await.unwrap();

    let overlaps = sessions::find_overlaps(&pool, "2026-10-20", "15:00", 60, None)
        .await
        .unwrap();
    assert_eq!(overlaps.len(), 1);
    assert_eq!(overlaps[0].id, first.id);

    // Bout à bout : pas de chevauchement. La séance elle-même est exclue.
    assert!(
        sessions::find_overlaps(&pool, "2026-10-20", "16:00", 60, None)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        sessions::find_overlaps(&pool, "2026-10-20", "14:30", 30, Some(&first.id))
            .await
            .unwrap()
            .is_empty()
    );
    // Le chevauchement n'empêche pas d'enregistrer.
    sessions::create_session(&pool, session("c2", "2026-10-20", Some("15:00"), Some(60)))
        .await
        .unwrap();
}

#[tokio::test]
async fn the_week_lists_sessions_in_chronological_order() {
    let pool = db().await;
    for (date, time) in [
        ("2026-10-21", Some("10:00")),
        ("2026-10-19", Some("16:00")),
        ("2026-10-19", Some("09:30")),
        ("2026-10-19", None),
        ("2026-10-26", Some("10:00")),
    ] {
        sessions::create_session(&pool, session("c1", date, time, None))
            .await
            .unwrap();
    }
    let week = sessions::list_sessions_between(&pool, "2026-10-19", "2026-10-25")
        .await
        .unwrap();
    let order: Vec<(String, Option<String>)> =
        week.into_iter().map(|s| (s.date, s.start_time)).collect();
    assert_eq!(
        order,
        vec![
            ("2026-10-19".into(), Some("09:30".into())),
            ("2026-10-19".into(), Some("16:00".into())),
            ("2026-10-19".into(), None),
            ("2026-10-21".into(), Some("10:00".into())),
        ]
    );
}

#[tokio::test]
async fn a_project_deposit_is_deducted_from_one_of_its_sessions() {
    let pool = db().await;
    let project = projects::create_project(&pool, project("c1"))
        .await
        .unwrap();
    let mut first = session("c1", "2026-10-20", Some("14:00"), Some(180));
    first.project_id = Some(project.id.clone());
    first.price_cents = Some(40_000);
    let first = sessions::create_session(&pool, first).await.unwrap();
    let lone = sessions::create_session(&pool, session("c1", "2026-11-02", None, None))
        .await
        .unwrap();

    let held = billing::record_deposit(&pool, deposit(Some(&project.id), None, 10_000))
        .await
        .unwrap();
    assert_eq!(held.status, Some(DepositStatus::Held));
    assert_eq!(
        projects::get_project(&pool, &project.id)
            .await
            .unwrap()
            .held_deposits_cents,
        10_000
    );

    // Pas sur une séance hors projet.
    let error = billing::apply_deposit(&pool, &held.id, &lone.id)
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Cet acompte n'est rattaché ni à cette séance ni à son projet"
    );

    let applied = billing::apply_deposit(&pool, &held.id, &first.id)
        .await
        .unwrap();
    assert_eq!(applied.status, Some(DepositStatus::Applied));
    let error = billing::apply_deposit(&pool, &held.id, &first.id)
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Cet acompte est déjà déduit d'une séance"
    );

    let bill = billing::get_session_billing(&pool, &first.id)
        .await
        .unwrap();
    assert_eq!(bill.applied_cents, 10_000);
    assert_eq!(bill.balance_cents, Some(30_000));
    assert_eq!(bill.state, BillingState::Partial);

    billing::record_payment(&pool, payment(&first.id, 30_000))
        .await
        .unwrap();
    let bill = billing::get_session_billing(&pool, &first.id)
        .await
        .unwrap();
    assert_eq!(bill.balance_cents, Some(0));
    assert_eq!(bill.state, BillingState::Paid);

    let summary = projects::get_project(&pool, &project.id).await.unwrap();
    assert_eq!(summary.held_deposits_cents, 0);
    assert_eq!(summary.received_cents, 40_000);
    assert_eq!(summary.sessions_price_cents, 40_000);
}

#[tokio::test]
async fn a_no_show_lets_the_studio_keep_or_refund_the_deposit() {
    let pool = db().await;
    let mut input = session("c1", "2026-10-20", Some("14:00"), Some(120));
    input.status = SessionStatus::NoShow;
    let missed = sessions::create_session(&pool, input).await.unwrap();
    assert_eq!(missed.client_no_show_count, 1);
    let held = billing::record_deposit(&pool, deposit(None, Some(&missed.id), 5_000))
        .await
        .unwrap();

    // Une séance manquée ne reçoit pas de déduction.
    let error = billing::apply_deposit(&pool, &held.id, &missed.id)
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Un acompte ne se déduit que d'une séance prévue ou terminée"
    );

    let forfeited = billing::settle_deposit(
        &pool,
        SettleDepositInput {
            deposit_id: held.id.clone(),
            outcome: OutcomeKind::Forfeited,
            session_id: Some(missed.id.clone()),
            reason: Some("Absence sans prévenir".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(forfeited.status, Some(DepositStatus::Forfeited));
    assert_eq!(
        forfeited.outcome_session_date.as_deref(),
        Some("2026-10-20")
    );

    // Un acompte avec une issue ne s'annule pas directement.
    let error = billing::void_deposit(&pool, &held.id, "Erreur")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("annule d'abord cette issue"));

    // L'issue saisie par erreur s'annule : l'acompte redevient en attente…
    let outcome_id = forfeited.outcome_id.unwrap();
    let back = billing::void_outcome(&pool, &outcome_id, "Le client a prévenu")
        .await
        .unwrap();
    assert_eq!(back.status, Some(DepositStatus::Held));
    // … et peut alors être remboursé.
    let refunded = billing::settle_deposit(
        &pool,
        SettleDepositInput {
            deposit_id: held.id.clone(),
            outcome: OutcomeKind::Refunded,
            session_id: None,
            reason: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(refunded.status, Some(DepositStatus::Refunded));
    let error = billing::void_outcome(&pool, &outcome_id, "Encore")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Cette issue est déjà annulée");
}

#[tokio::test]
async fn a_held_deposit_is_voided_with_a_reason() {
    let pool = db().await;
    let s = sessions::create_session(&pool, session("c1", "2026-10-20", None, None))
        .await
        .unwrap();
    let held = billing::record_deposit(&pool, deposit(None, Some(&s.id), 5_000))
        .await
        .unwrap();
    let error = billing::void_deposit(&pool, &held.id, " ")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Le motif d'annulation est obligatoire");
    let voided = billing::void_deposit(&pool, &held.id, "Montant faux")
        .await
        .unwrap();
    assert_eq!(voided.status, Some(DepositStatus::Voided));
    let error = billing::apply_deposit(&pool, &held.id, &s.id)
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Cet acompte est annulé");
}

#[tokio::test]
async fn deposits_are_checked_against_their_project_and_client() {
    let pool = db().await;
    let p1 = projects::create_project(&pool, project("c1"))
        .await
        .unwrap();
    let other = sessions::create_session(&pool, session("c2", "2026-10-20", None, None))
        .await
        .unwrap();
    let error = billing::record_deposit(&pool, deposit(None, None, 5_000))
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Un acompte se rattache à un projet ou à une séance"
    );
    let error = billing::record_deposit(&pool, deposit(Some(&p1.id), Some(&other.id), 5_000))
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Cette séance ne fait pas partie du projet"
    );
    let error = billing::record_deposit(&pool, deposit(Some(&p1.id), None, 0))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Le montant doit être positif");
    let mut future = deposit(Some(&p1.id), None, 5_000);
    future.received_on = "2999-01-01".into();
    let error = billing::record_deposit(&pool, future).await.unwrap_err();
    assert_eq!(
        error.to_string(),
        "La date d'encaissement ne peut pas être dans le futur"
    );

    let held = billing::record_deposit(&pool, deposit(Some(&p1.id), None, 5_000))
        .await
        .unwrap();
    let error = billing::settle_deposit(
        &pool,
        SettleDepositInput {
            deposit_id: held.id,
            outcome: OutcomeKind::Forfeited,
            session_id: Some(other.id),
            reason: None,
        },
    )
    .await
    .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Cet acompte a été versé par un autre client"
    );
}

#[tokio::test]
async fn payments_sum_up_and_a_voided_payment_no_longer_counts() {
    let pool = db().await;
    let mut input = session("c1", "2026-10-20", None, None);
    input.price_cents = Some(20_000);
    let s = sessions::create_session(&pool, input).await.unwrap();
    assert_eq!(
        billing::get_session_billing(&pool, &s.id)
            .await
            .unwrap()
            .state,
        BillingState::Unpaid
    );

    let first = billing::record_payment(&pool, payment(&s.id, 15_000))
        .await
        .unwrap();
    billing::record_payment(&pool, payment(&s.id, 10_000))
        .await
        .unwrap();
    let bill = billing::get_session_billing(&pool, &s.id).await.unwrap();
    assert_eq!(bill.state, BillingState::Overpaid);
    assert_eq!(bill.balance_cents, Some(-5_000));

    billing::void_payment(&pool, &first.id, "Double saisie")
        .await
        .unwrap();
    let bill = billing::get_session_billing(&pool, &s.id).await.unwrap();
    assert_eq!(bill.payments_cents, 10_000);
    assert_eq!(bill.state, BillingState::Partial);
    assert_eq!(bill.payments.len(), 2);
    let error = billing::void_payment(&pool, &first.id, "Encore")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Ce paiement est déjà annulé");
}

#[tokio::test]
async fn money_cannot_be_rewritten_or_deleted_in_the_database() {
    let pool = db().await;
    let s = sessions::create_session(&pool, session("c1", "2026-10-20", None, None))
        .await
        .unwrap();
    let paid = billing::record_payment(&pool, payment(&s.id, 15_000))
        .await
        .unwrap();
    let held = billing::record_deposit(&pool, deposit(None, Some(&s.id), 5_000))
        .await
        .unwrap();
    for sql in [
        "UPDATE payments SET amount_cents = 1 WHERE id = ?",
        "DELETE FROM payments WHERE id = ?",
        "UPDATE deposits SET amount_cents = 1 WHERE id = ?",
        "DELETE FROM deposits WHERE id = ?",
    ] {
        let id = if sql.contains("payments") {
            &paid.id
        } else {
            &held.id
        };
        assert!(
            sqlx::query(sql).bind(id).execute(&pool).await.is_err(),
            "{sql}"
        );
    }
}

#[tokio::test]
async fn a_session_with_money_keeps_its_client() {
    let pool = db().await;
    let s = sessions::create_session(&pool, session("c1", "2026-10-20", None, None))
        .await
        .unwrap();
    billing::record_payment(&pool, payment(&s.id, 15_000))
        .await
        .unwrap();
    let error = sessions::update_session(&pool, &s.id, session("c2", "2026-10-20", None, None))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), SESSION_CLIENT_LOCKED_MONEY);
}

#[tokio::test]
async fn a_project_with_sessions_keeps_its_client() {
    let pool = db().await;
    let p = projects::create_project(&pool, project("c1"))
        .await
        .unwrap();
    // Sans séance ni acompte : le client se corrige.
    let moved = projects::update_project(&pool, &p.id, project("c2"))
        .await
        .unwrap();
    assert_eq!(moved.client_id, "c2");
    let mut input = session("c2", "2026-10-20", None, None);
    input.project_id = Some(p.id.clone());
    sessions::create_session(&pool, input).await.unwrap();
    let error = projects::update_project(&pool, &p.id, project("c1"))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), projects::PROJECT_CLIENT_LOCKED);
}

#[tokio::test]
async fn a_session_keeps_a_title_without_a_project() {
    let pool = db().await;
    let mut input = session("c1", "2026-10-20", None, None);
    input.title = Some("  Retouche  ".into());
    let saved = sessions::create_session(&pool, input).await.unwrap();
    assert_eq!(saved.title.as_deref(), Some("Retouche"));
    assert!(saved.project_id.is_none());
}

#[tokio::test]
async fn an_empty_title_is_numbered_from_the_project() {
    let pool = db().await;
    let tree = projects::create_project(
        &pool,
        ProjectInput {
            title: "Arbre".into(),
            ..project("c1")
        },
    )
    .await
    .unwrap();

    let mut first = session("c1", "2026-10-01", None, None);
    first.project_id = Some(tree.id.clone());
    let first = sessions::create_session(&pool, first).await.unwrap();
    assert_eq!(first.title.as_deref(), Some("Arbre séance 1"));

    let mut second = session("c1", "2026-11-01", None, None);
    second.project_id = Some(tree.id.clone());
    let second = sessions::create_session(&pool, second).await.unwrap();
    assert_eq!(second.title.as_deref(), Some("Arbre séance 2"));

    // Vider le titre d'une séance déjà liée le recalcule, sans compter la séance elle-même.
    let mut cleared = session("c1", "2026-10-01", None, None);
    cleared.project_id = Some(tree.id);
    let cleared = sessions::update_session(&pool, &first.id, cleared)
        .await
        .unwrap();
    assert_eq!(cleared.title.as_deref(), Some("Arbre séance 2"));
}

#[tokio::test]
async fn a_typed_title_is_not_replaced_when_the_project_changes() {
    let pool = db().await;
    let tree = projects::create_project(
        &pool,
        ProjectInput {
            title: "Arbre".into(),
            ..project("c1")
        },
    )
    .await
    .unwrap();
    let moon = projects::create_project(
        &pool,
        ProjectInput {
            title: "Lune".into(),
            ..project("c1")
        },
    )
    .await
    .unwrap();

    let mut input = session("c1", "2026-10-01", None, None);
    input.project_id = Some(tree.id);
    input.title = Some("Première passe".into());
    let saved = sessions::create_session(&pool, input).await.unwrap();
    assert_eq!(saved.title.as_deref(), Some("Première passe"));

    let mut moved = session("c1", "2026-10-01", None, None);
    moved.project_id = Some(moon.id.clone());
    moved.title = Some("Première passe".into());
    let moved_session = sessions::update_session(&pool, &saved.id, moved)
        .await
        .unwrap();
    assert_eq!(moved_session.project_id.as_deref(), Some(moon.id.as_str()));
    assert_eq!(moved_session.title.as_deref(), Some("Première passe"));

    let mut detached = session("c1", "2026-10-01", None, None);
    detached.title = Some("Première passe".into());
    let detached = sessions::update_session(&pool, &saved.id, detached)
        .await
        .unwrap();
    assert!(detached.project_id.is_none());
    assert_eq!(detached.title.as_deref(), Some("Première passe"));
}

#[tokio::test]
async fn aftercare_can_be_checked_and_cleared() {
    let pool = db().await;
    let session = sessions::create_session(&pool, session("c1", "2026-10-20", None, None))
        .await
        .unwrap();
    assert!(!session.aftercare_explained);

    let checked = sessions::set_aftercare_explained(&pool, &session.id, true)
        .await
        .unwrap();
    assert!(checked.aftercare_explained);
    let again = sessions::set_aftercare_explained(&pool, &session.id, true)
        .await
        .unwrap();
    assert!(again.aftercare_explained);

    let cleared = sessions::set_aftercare_explained(&pool, &session.id, false)
        .await
        .unwrap();
    assert!(!cleared.aftercare_explained);

    let updates: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log
         WHERE session_id = ? AND action = 'UPDATE'
           AND after_json LIKE '%aftercare_explained%'",
    )
    .bind(&session.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(updates, 2);
}

#[tokio::test]
async fn archived_session_or_client_refuses_aftercare() {
    let pool = db().await;
    let archived = sessions::create_session(&pool, session("c1", "2026-10-20", None, None))
        .await
        .unwrap();
    sqlx::query("UPDATE sessions SET archived_at = '2026-10-20T00:00:00' WHERE id = ?")
        .bind(&archived.id)
        .execute(&pool)
        .await
        .unwrap();
    let error = sessions::set_aftercare_explained(&pool, &archived.id, true)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("archivée"));

    let other = sessions::create_session(&pool, session("c2", "2026-10-21", None, None))
        .await
        .unwrap();
    sqlx::query("UPDATE clients SET archived_at = '2026-10-20T00:00:00' WHERE id = 'c2'")
        .execute(&pool)
        .await
        .unwrap();
    let error = sessions::set_aftercare_explained(&pool, &other.id, true)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("client est archivé"));
}

//! Tableau de bord, synthèses de période et exports CSV.

use chrono::NaiveDate;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::billing::{self, DepositInput, PaymentInput, PaymentMethod};
use super::dashboard;
use super::exports::{self, ExportKind};
use super::lots::{self, CreateLotInput};
use super::session_usages::{self, LinkSessionInput, VoidUsageInput};
use super::sessions::{self, SessionInput};
use super::units;
use crate::models::SessionStatus;

const TODAY: &str = "2026-10-15";

fn today() -> NaiveDate {
    NaiveDate::parse_from_str(TODAY, "%Y-%m-%d").unwrap()
}

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
    for (id, first, last, created) in [
        ("c1", "Léa", "Martin", "2026-09-01T10:00:00"),
        ("c2", "Nina", "=Dupont", "2026-10-03T10:00:00"),
    ] {
        sqlx::query(
            "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(first)
        .bind(last)
        .bind(created)
        .bind(created)
        .execute(&pool)
        .await
        .unwrap();
    }
    pool
}

async fn session(
    pool: &SqlitePool,
    client_id: &str,
    date: &str,
    start: Option<&str>,
    status: SessionStatus,
    price_cents: Option<i64>,
) -> String {
    sessions::create_session(
        pool,
        SessionInput {
            client_id: client_id.into(),
            project_id: None,
            date: date.into(),
            start_time: start.map(Into::into),
            duration_minutes: start.map(|_| 120),
            status,
            price_cents,
            body_area: Some("Avant-bras".into()),
            description: None,
            notes: None,
        },
    )
    .await
    .unwrap()
    .id
}

async fn pay(pool: &SqlitePool, session_id: &str, cents: i64, method: PaymentMethod, on: &str) {
    billing::record_payment(
        pool,
        PaymentInput {
            session_id: session_id.into(),
            amount_cents: cents,
            method,
            paid_on: on.into(),
            note: None,
        },
    )
    .await
    .unwrap();
}

async fn deposit(pool: &SqlitePool, session_id: &str, cents: i64, on: &str) -> String {
    billing::record_deposit(
        pool,
        DepositInput {
            project_id: None,
            session_id: Some(session_id.into()),
            amount_cents: cents,
            method: PaymentMethod::Transfer,
            received_on: on.into(),
            note: None,
        },
    )
    .await
    .unwrap()
    .id
}

fn lot(name: &str, expiration: &str, single_use: bool, quantity: i64) -> CreateLotInput {
    CreateLotInput {
        name: name.into(),
        lot_number: format!("L-{name}"),
        creation_date: None,
        expiration_date: expiration.into(),
        single_use,
        after_opening_months: if single_use { None } else { Some(6) },
        product_url: None,
        quantity,
        category_id: None,
        product_id: None,
    }
}

struct Fixture {
    pool: SqlitePool,
    today_session: String,
    done: String,
    paid: String,
    past_planned: String,
    no_show: String,
}

async fn fixture() -> Fixture {
    let pool = db().await;
    let today_session = session(
        &pool,
        "c1",
        TODAY,
        Some("14:00"),
        SessionStatus::Planned,
        Some(30_000),
    )
    .await;
    session(
        &pool,
        "c2",
        TODAY,
        Some("10:00"),
        SessionStatus::Planned,
        None,
    )
    .await;
    session(
        &pool,
        "c2",
        "2026-10-18",
        Some("09:00"),
        SessionStatus::Planned,
        None,
    )
    .await;
    // Hors de la fenêtre des 7 jours.
    session(
        &pool,
        "c2",
        "2026-11-04",
        None,
        SessionStatus::Planned,
        None,
    )
    .await;
    let past_planned = session(
        &pool,
        "c1",
        "2026-10-10",
        None,
        SessionStatus::Planned,
        None,
    )
    .await;

    let done = session(
        &pool,
        "c1",
        "2026-10-05",
        None,
        SessionStatus::Completed,
        Some(20_000),
    )
    .await;
    pay(&pool, &done, 5_000, PaymentMethod::Card, "2026-10-05").await;
    let applied = deposit(&pool, &done, 3_000, "2026-10-02").await;
    billing::apply_deposit(&pool, &applied, &done)
        .await
        .unwrap();

    let paid = session(
        &pool,
        "c2",
        "2026-10-06",
        None,
        SessionStatus::Completed,
        Some(10_000),
    )
    .await;
    pay(&pool, &paid, 10_000, PaymentMethod::Cash, "2026-10-06").await;

    let no_show = session(&pool, "c2", "2026-10-08", None, SessionStatus::NoShow, None).await;
    deposit(&pool, &no_show, 5_000, "2026-10-01").await;

    // Remboursement enregistré le 12 octobre, et un paiement annulé : ignoré partout.
    let refunded = deposit(&pool, &past_planned, 2_000, "2026-10-01").await;
    sqlx::query(
        "INSERT INTO deposit_outcomes (id, deposit_id, outcome, reason, created_at)
         VALUES ('o-refund', ?, 'REFUNDED', 'Projet abandonné', '2026-10-12T10:00:00')",
    )
    .bind(&refunded)
    .execute(&pool)
    .await
    .unwrap();
    pay(&pool, &paid, 999, PaymentMethod::Card, "2026-10-06").await;
    let voided: String = sqlx::query_scalar("SELECT id FROM payments WHERE amount_cents = 999")
        .fetch_one(&pool)
        .await
        .unwrap();
    billing::void_payment(&pool, &voided, "Doublon")
        .await
        .unwrap();

    Fixture {
        pool,
        today_session,
        done,
        paid,
        past_planned,
        no_show,
    }
}

#[tokio::test]
async fn the_dashboard_lists_today_and_the_coming_week() {
    let f = fixture().await;
    let board = dashboard::get_dashboard(&f.pool, today()).await.unwrap();
    assert_eq!(board.today, TODAY);
    let times: Vec<_> = board
        .today_sessions
        .iter()
        .map(|s| s.session.start_time.clone().unwrap())
        .collect();
    assert_eq!(times, ["10:00", "14:00"]);
    let mine = board
        .today_sessions
        .iter()
        .find(|s| s.session.id == f.today_session)
        .unwrap();
    assert_eq!(mine.balance_cents, Some(30_000));
    assert!(!mine.session.health_signed && !mine.session.consent_signed);

    let upcoming: Vec<_> = board
        .upcoming
        .iter()
        .map(|s| s.session.date.as_str())
        .collect();
    assert_eq!(upcoming, ["2026-10-18"]);
}

#[tokio::test]
async fn alerts_point_at_what_needs_an_action() {
    let f = fixture().await;
    let board = dashboard::get_dashboard(&f.pool, today()).await.unwrap();
    let alerts = &board.alerts;

    let to_close: Vec<_> = alerts
        .sessions_to_close
        .iter()
        .map(|s| &s.session.id)
        .collect();
    assert_eq!(to_close, [&f.past_planned]);

    // Reste à payer : même calcul que la fiche de la séance.
    assert_eq!(alerts.unpaid.len(), 1);
    assert_eq!(alerts.unpaid[0].session.id, f.done);
    assert_eq!(alerts.unpaid[0].balance_cents, Some(12_000));
    let billing = billing::get_session_billing(&f.pool, &f.done)
        .await
        .unwrap();
    assert_eq!(billing.balance_cents, alerts.unpaid[0].balance_cents);
    let paid = billing::get_session_billing(&f.pool, &f.paid)
        .await
        .unwrap();
    assert_eq!(paid.balance_cents, Some(0));

    let deposits: Vec<_> = alerts
        .deposits_to_settle
        .iter()
        .map(|d| &d.session_id)
        .collect();
    assert_eq!(deposits, [&f.no_show]);
    assert_eq!(alerts.deposits_to_settle[0].amount_cents, 5_000);

    let unsigned: Vec<_> = alerts.unsigned.iter().map(|s| &s.session.id).collect();
    assert_eq!(unsigned, [&f.done, &f.paid]);
}

#[tokio::test]
async fn products_in_stock_are_flagged_before_and_after_their_limit() {
    let pool = db().await;
    lots::create_lot(&pool, lot("Périmé", "2026-10-01", true, 4))
        .await
        .unwrap();
    lots::create_lot(&pool, lot("Bientôt", "2026-11-01", true, 5))
        .await
        .unwrap();
    lots::create_lot(&pool, lot("Loin", "2030-01-01", true, 5))
        .await
        .unwrap();
    let ink = lots::create_lot(&pool, lot("Encre", "2030-01-01", false, 2))
        .await
        .unwrap();
    let pieces = units::list_units(&pool, &ink.id).await.unwrap();
    units::open_unit(&pool, &pieces[0].id, "2026-04-20".into())
        .await
        .unwrap();

    let board = dashboard::get_dashboard(&pool, today()).await.unwrap();
    let expired: Vec<_> = board
        .alerts
        .expired
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    assert_eq!(expired, ["Périmé"]);
    assert_eq!(board.alerts.expired[0].count, 4);
    let soon: Vec<_> = board
        .alerts
        .expiring_soon
        .iter()
        .map(|i| (i.name.as_str(), i.kind, i.useful_until.as_str()))
        .collect();
    // La pièce ouverte le 20 avril (6 mois) passe avant le lot du 1er novembre ;
    // la pièce scellée de la même encre n'est pas signalée.
    assert_eq!(
        soon,
        [
            ("Encre", "OPENED", "2026-10-20"),
            ("Bientôt", "LOT", "2026-11-01")
        ]
    );
}

#[tokio::test]
async fn the_month_summary_counts_money_in_and_out() {
    let f = fixture().await;
    let board = dashboard::get_dashboard(&f.pool, today()).await.unwrap();
    let month = &board.month;
    assert_eq!(
        (month.from.as_str(), month.to.as_str()),
        ("2026-10-01", "2026-10-31")
    );
    assert_eq!(month.payments_cents, 15_000);
    assert_eq!(month.deposits_cents, 3_000 + 5_000 + 2_000);
    assert_eq!(month.refunds_cents, 2_000);
    assert_eq!(month.collected_cents, 15_000 + 10_000 - 2_000);
    let by_method: Vec<_> = month
        .by_method
        .iter()
        .map(|m| (m.method, m.cents))
        .collect();
    assert_eq!(
        by_method,
        [
            (PaymentMethod::Cash, 10_000),
            (PaymentMethod::Transfer, 10_000),
            (PaymentMethod::Card, 5_000)
        ]
    );
    assert_eq!(month.sessions_completed, 2);
    assert_eq!(month.completed_price_cents, 30_000);
    assert_eq!(month.sessions_no_show, 1);
    assert_eq!(month.new_clients, 1);
    assert_eq!(board.previous_month.from, "2026-09-01");
    assert_eq!(board.previous_month.new_clients, 1);
    assert_eq!(board.previous_month.collected_cents, 0);

    assert!(
        dashboard::period_summary(&f.pool, "2026-10-31", "2026-10-01")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn exports_are_ready_for_a_french_spreadsheet() {
    let f = fixture().await;
    let csv = exports::export(&f.pool, ExportKind::Payments, "2026-10-01", "2026-10-31")
        .await
        .unwrap();
    assert!(csv.bytes().starts_with(&[0xEF, 0xBB, 0xBF]));
    let lines: Vec<_> = csv.content.lines().collect();
    assert_eq!(
        lines[0],
        "Date;Type;Nom;Prénom;Séance du;Projet;Mode;Montant (€)"
    );
    // 2 paiements + 3 acomptes + 1 remboursement, le paiement annulé exclu.
    assert_eq!(csv.rows, 6);
    assert!(lines.iter().any(
        |l| l.starts_with("2026-10-12;Remboursement d'acompte;Martin;Léa")
            && l.ends_with(";Virement;-20,00")
    ));
    // Un nom qui commence par « = » n'est pas lu comme une formule.
    assert!(lines.iter().any(|l| l.contains(";'=Dupont;Nina;")));
    assert_eq!(*lines.last().unwrap(), ";Total;;;;;;230,00");

    let csv = exports::export(&f.pool, ExportKind::Sessions, "2026-10-05", "2026-10-05")
        .await
        .unwrap();
    assert_eq!(csv.rows, 1);
    assert!(csv
        .content
        .contains("2026-10-05;;;Martin;Léa;;Avant-bras;Terminée;200,00;80,00;120,00"));

    assert!(
        exports::export(&f.pool, ExportKind::Sessions, "hier", "2026-10-05")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn the_traceability_export_keeps_voided_links() {
    let pool = db().await;
    let session_id = session(
        &pool,
        "c1",
        "2026-10-05",
        None,
        SessionStatus::Completed,
        None,
    )
    .await;
    let needles = lots::create_lot(&pool, lot("Aiguille", "2030-01-01", true, 10))
        .await
        .unwrap();
    let usage = session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session_id.clone(),
            lot_id: Some(needles.id.clone()),
            unit_id: None,
            quantity: Some(2),
        },
    )
    .await
    .unwrap();
    let ink = lots::create_lot(&pool, lot("Encre", "2026-10-01", false, 1))
        .await
        .unwrap();
    let piece = &units::list_units(&pool, &ink.id).await.unwrap()[0];
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session_id.clone(),
            lot_id: None,
            unit_id: Some(piece.id.clone()),
            quantity: None,
        },
    )
    .await
    .unwrap();
    session_usages::void_usage(
        &pool,
        VoidUsageInput {
            usage_id: usage.id,
            reason: "Mauvais lot; saisi deux fois".into(),
        },
    )
    .await
    .unwrap();

    let csv = exports::export(&pool, ExportKind::Traceability, "2026-10-01", "2026-10-31")
        .await
        .unwrap();
    assert_eq!(csv.rows, 2, "{}", csv.content);
    assert!(csv.content.contains(
        "2026-10-05;Martin;Léa;Aiguille;L-Aiguille;Usage unique;;2;2030-01-01;Non;\"Mauvais lot; saisi deux fois\""
    ), "{}", csv.content);
    // Encre périmée le 1er octobre, utilisée le 5 : signalé.
    assert!(csv
        .content
        .contains("Encre;L-Encre;Encre (flacon);;;2026-10-01;Oui;"));
}

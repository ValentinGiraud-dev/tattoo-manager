use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::error::LotError;
use super::lots::{self, CreateLotInput};
use super::session_usages::{self, LinkSessionInput};
use super::stock::{self, MovementType, RecordMovementInput};
use super::units;

struct TestDb {
    pool: SqlitePool,
    path: PathBuf,
}

impl Drop for TestDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

async fn empty_db() -> TestDb {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_DB: AtomicU64 = AtomicU64::new(0);
    let n = NEXT_DB.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "tracink-{}-{}-{}.sqlite",
        std::process::id(),
        n,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    TestDb { pool, path }
}

async fn migrated() -> TestDb {
    let db = empty_db().await;
    sqlx::migrate!("./migrations").run(&db.pool).await.unwrap();
    db
}

fn migration_sql(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("migrations")
        .join(name);
    std::fs::read_to_string(path).unwrap()
}

async fn exec_migration(pool: &SqlitePool, name: &str) {
    sqlx::raw_sql(&migration_sql(name))
        .execute(pool)
        .await
        .unwrap();
}

async fn apply_schema_before_lots(pool: &SqlitePool) {
    for name in [
        "001_clients.sql",
        "002_sessions.sql",
        "003_products.sql",
        "004_session_products.sql",
        "005_session_indexes.sql",
    ] {
        exec_migration(pool, name).await;
    }
}

fn needle(quantity: i64) -> CreateLotInput {
    CreateLotInput {
        name: "Aiguille 3RL".into(),
        lot_number: "N-1".into(),
        creation_date: None,
        expiration_date: "2030-01-01".into(),
        single_use: true,
        after_opening_months: None,
        product_url: None,
        quantity,
        category_id: None,
        product_id: None,
    }
}

fn ink(quantity: i64) -> CreateLotInput {
    CreateLotInput {
        name: "Encre noire".into(),
        lot_number: "E-1".into(),
        creation_date: None,
        expiration_date: "2030-01-01".into(),
        single_use: false,
        after_opening_months: Some(6),
        product_url: None,
        quantity,
        category_id: None,
        product_id: None,
    }
}

async fn seed_session(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Léa', 'Martin', '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO sessions (id, client_id, date, status, created_at, updated_at)
         VALUES ('s1', 'c1', '2026-10-14', 'PLANNED', '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn stock_is_the_sum_of_movements_and_cannot_go_negative() {
    let db = migrated().await;
    seed_session(&db.pool).await;
    let lot = lots::create_lot(&db.pool, needle(50)).await.unwrap();
    assert_eq!(lot.stock, 50);

    lots::record_movement(
        &db.pool,
        RecordMovementInput {
            lot_id: lot.id.clone(),
            movement_type: MovementType::Loss.as_str().into(),
            quantity: 2,
            reason: None,
        },
    )
    .await
    .unwrap();

    session_usages::link_session(
        &db.pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: Some(lot.id.clone()),
            unit_id: None,
            quantity: Some(3),
        },
    )
    .await
    .unwrap();

    let lot = lots::get_lot(&db.pool, &lot.id).await.unwrap();
    assert_eq!(lot.stock, 45);

    let error = session_usages::link_session(
        &db.pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: Some(lot.id.clone()),
            unit_id: None,
            quantity: Some(100),
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(error, LotError::Invalid(_)));
    let lot = lots::get_lot(&db.pool, &lot.id).await.unwrap();
    assert_eq!(lot.stock, 45);

    let fixed = lots::record_movement(
        &db.pool,
        RecordMovementInput {
            lot_id: lot.id.clone(),
            movement_type: "ADJUSTMENT".into(),
            quantity: -5,
            reason: Some("comptage".into()),
        },
    )
    .await
    .unwrap();
    assert_eq!(fixed.stock, 40);
}

#[tokio::test]
async fn linking_a_single_use_lot_again_adds_a_movement_without_a_second_link() {
    let db = migrated().await;
    seed_session(&db.pool).await;
    let lot = lots::create_lot(&db.pool, needle(10)).await.unwrap();
    let input = |quantity| LinkSessionInput {
        session_id: "s1".into(),
        lot_id: Some(lot.id.clone()),
        unit_id: None,
        quantity: Some(quantity),
    };
    session_usages::link_session(&db.pool, input(1))
        .await
        .unwrap();
    session_usages::link_session(&db.pool, input(2))
        .await
        .unwrap();

    let links = session_usages::list_session_usages(&db.pool, "s1")
        .await
        .unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].quantity, 3);
    assert_eq!(lots::get_lot(&db.pool, &lot.id).await.unwrap().stock, 7);
}

#[tokio::test]
async fn single_use_lot_rejects_an_opening_date() {
    let db = migrated().await;
    let mut input = needle(5);
    input.after_opening_months = Some(6);
    let error = lots::create_lot(&db.pool, input).await.unwrap_err();
    assert_eq!(
        error.to_string(),
        "Un usage unique n'a pas de durée après ouverture"
    );

    let lot = lots::create_lot(&db.pool, needle(5)).await.unwrap();
    sqlx::query(
        "INSERT INTO units (id, lot_id, opened_at, created_at, updated_at)
         VALUES ('u-bad', ?, NULL, '2026-10-01T00:00:00', '2026-10-01T00:00:00')",
    )
    .bind(&lot.id)
    .execute(&db.pool)
    .await
    .unwrap();
    let error = units::open_unit(&db.pool, "u-bad", "2026-10-14".into())
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "Un usage unique n'a pas de date d'ouverture"
    );
}

#[tokio::test]
async fn a_lot_of_ink_creates_bottles_and_a_session_does_not_consume_one() {
    let db = migrated().await;
    seed_session(&db.pool).await;
    let lot = lots::create_lot(&db.pool, ink(6)).await.unwrap();
    assert_eq!(lot.stock, 6);
    assert_eq!(lot.sealed_count, 6);

    let bottles = units::list_units(&db.pool, &lot.id).await.unwrap();
    assert_eq!(bottles.len(), 6);

    session_usages::link_session(
        &db.pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: None,
            unit_id: Some(bottles[0].id.clone()),
            quantity: None,
        },
    )
    .await
    .unwrap();
    let lot = lots::get_lot(&db.pool, &lot.id).await.unwrap();
    assert_eq!(lot.stock, 6);

    units::open_unit(&db.pool, &bottles[0].id, "2026-10-01".into())
        .await
        .unwrap();
    units::exit_unit(&db.pool, &bottles[0].id, "CONSUMPTION")
        .await
        .unwrap();
    let lot = lots::get_lot(&db.pool, &lot.id).await.unwrap();
    assert_eq!(lot.stock, 5);
    assert_eq!(lot.opened_count, 0);

    let error = units::exit_unit(&db.pool, &bottles[0].id, "LOSS")
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Cette pièce est déjà sortie du stock");
    assert_eq!(lots::get_lot(&db.pool, &lot.id).await.unwrap().stock, 5);
}

#[tokio::test]
async fn undoing_a_wrong_exit_puts_the_piece_back_in_stock() {
    let db = migrated().await;
    let lot = lots::create_lot(&db.pool, ink(1)).await.unwrap();
    let pieces = units::list_units(&db.pool, &lot.id).await.unwrap();
    units::exit_unit(&db.pool, &pieces[0].id, "EXPIRATION")
        .await
        .unwrap();
    assert_eq!(lots::get_lot(&db.pool, &lot.id).await.unwrap().stock, 0);

    let exit = stock::list_movements(&db.pool, &lot.id)
        .await
        .unwrap()
        .into_iter()
        .find(|movement| movement.movement_type == "EXPIRATION")
        .unwrap();
    stock::undo_movement(&db.pool, &exit.id).await.unwrap();

    assert_eq!(lots::get_lot(&db.pool, &lot.id).await.unwrap().stock, 1);
    assert!(units::list_units(&db.pool, &lot.id).await.unwrap()[0].in_stock);
}

#[tokio::test]
async fn undoing_a_session_consumption_restores_the_counted_quantity() {
    let db = migrated().await;
    seed_session(&db.pool).await;
    let lot = lots::create_lot(&db.pool, needle(10)).await.unwrap();
    session_usages::link_session(
        &db.pool,
        LinkSessionInput {
            session_id: "s1".into(),
            lot_id: Some(lot.id.clone()),
            unit_id: None,
            quantity: Some(2),
        },
    )
    .await
    .unwrap();

    let consumption = stock::list_movements(&db.pool, &lot.id)
        .await
        .unwrap()
        .into_iter()
        .find(|movement| movement.movement_type == "CONSUMPTION")
        .unwrap();
    stock::undo_movement(&db.pool, &consumption.id)
        .await
        .unwrap();

    assert_eq!(lots::get_lot(&db.pool, &lot.id).await.unwrap().stock, 10);
    let links = session_usages::list_session_usages(&db.pool, "s1")
        .await
        .unwrap();
    assert_eq!(links[0].quantity, 0);
}

#[tokio::test]
async fn adding_quantity_reuses_the_same_lot() {
    let db = migrated().await;
    let first = lots::create_lot(&db.pool, needle(10)).await.unwrap();
    let mut again = needle(4);
    again.name = "aiguille 3rl".into();
    again.expiration_date = "1999-01-01".into();
    let second = lots::create_lot(&db.pool, again).await.unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(second.stock, 14);
    assert_eq!(second.expiration_date, "2030-01-01");

    let mut ink_on_needle = ink(1);
    ink_on_needle.name = first.name.clone();
    ink_on_needle.lot_number = first.lot_number.clone();
    let error = lots::create_lot(&db.pool, ink_on_needle).await.unwrap_err();
    assert_eq!(error.to_string(), "Ce lot existe déjà avec un autre type");
}

#[tokio::test]
async fn migration_copies_existing_products_without_inventing_needle_stock() {
    let db = empty_db().await;
    apply_schema_before_lots(&db.pool).await;
    seed_session(&db.pool).await;
    sqlx::query(
        "INSERT INTO products
            (id, name, lot_number, opened_at, expiration_date, after_opening_months,
             single_use, created_at, updated_at)
         VALUES
            ('ink-a', 'Encre noire', 'E-9', NULL, '2030-01-01', 12, 0,
             '2026-01-01T00:00:00', '2026-01-01T00:00:00'),
            ('ink-b', 'Encre noire', 'E-9', '2026-02-01', '2030-01-01', 12, 0,
             '2026-01-02T00:00:00', '2026-01-02T00:00:00'),
            ('needle', 'Aiguille', 'N-9', '2026-03-01', '2030-06-01', NULL, 1,
             '2026-01-03T00:00:00', '2026-01-03T00:00:00')",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO session_products (session_id, product_id, created_at) VALUES
            ('s1', 'ink-a', '2026-04-01T00:00:00'),
            ('s1', 'needle', '2026-04-02T00:00:00')",
    )
    .execute(&db.pool)
    .await
    .unwrap();

    exec_migration(&db.pool, "006_lots_and_stock.sql").await;
    // Les requêtes actuelles lisent aussi les tables des migrations suivantes.
    exec_migration(&db.pool, "007_session_usage_voids.sql").await;
    exec_migration(&db.pool, "011_product_categories.sql").await;
    exec_migration(&db.pool, "013_product_sheets.sql").await;
    exec_migration(&db.pool, "014_low_stock.sql").await;

    let lots = lots::list_lots(&db.pool, None).await.unwrap();
    assert_eq!(lots.len(), 2);
    let ink = lots.iter().find(|lot| lot.name == "Encre noire").unwrap();
    assert_eq!(ink.stock, 2);
    assert_eq!(ink.sealed_count, 1);
    assert_eq!(ink.opened_count, 1);
    let needle = lots.iter().find(|lot| lot.single_use).unwrap();
    assert_eq!(needle.stock, 0);
    assert_eq!(needle.movement_count, 0);

    let links = session_usages::list_session_usages(&db.pool, "s1")
        .await
        .unwrap();
    assert_eq!(links.len(), 2);
    assert!(links
        .iter()
        .any(|link| link.unit_id.as_deref() == Some("ink-a")));
    assert!(links
        .iter()
        .any(|link| link.lot_id.as_deref() == Some("needle")));
    let movements = stock::list_movements(&db.pool, &needle.id).await.unwrap();
    assert!(movements.is_empty());
}

#[tokio::test]
async fn migration_refuses_to_merge_incompatible_lots() {
    let db = empty_db().await;
    apply_schema_before_lots(&db.pool).await;
    sqlx::query(
        "INSERT INTO products
            (id, name, lot_number, expiration_date, single_use, created_at, updated_at)
         VALUES
            ('a', 'Aiguille', 'L1', '2030-01-01', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00'),
            ('b', 'Aiguille', 'l1', '2031-01-01', 1, '2026-01-02T00:00:00', '2026-01-02T00:00:00')",
    )
    .execute(&db.pool)
    .await
    .unwrap();

    let error = sqlx::raw_sql(&migration_sql("006_lots_and_stock.sql"))
        .execute(&db.pool)
        .await
        .unwrap_err();
    let message = error.to_string();
    assert!(
        message.contains("péremption"),
        "message inattendu : {message}"
    );
}

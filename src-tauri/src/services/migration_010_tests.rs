//! La migration 010 supprime les anciennes tables products et session_products,
//! seulement si tout leur contenu a bien été recopié dans les lots (migration 006).

use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Connection, SqlitePool};

fn migration(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("migrations")
        .join(name);
    std::fs::read_to_string(path).unwrap()
}

async fn pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .in_memory(true)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap()
}

/// Comme sqlx : chaque migration dans une transaction.
async fn run(pool: &SqlitePool, name: &str) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    let mut tx = conn.begin().await?;
    sqlx::raw_sql(&migration(name)).execute(&mut *tx).await?;
    tx.commit().await
}

async fn table_exists(pool: &SqlitePool, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
        == 1
}

/// Base d'une version d'avant les lots, avec un client, une séance, une aiguille
/// (usage unique) et une encre (pièce), toutes deux liées à la séance.
async fn legacy_database() -> SqlitePool {
    let pool = pool().await;
    for name in [
        "001_clients.sql",
        "002_sessions.sql",
        "003_products.sql",
        "004_session_products.sql",
        "005_session_indexes.sql",
    ] {
        run(&pool, name).await.unwrap();
    }
    sqlx::raw_sql(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Léa', 'Martin', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
         INSERT INTO sessions (id, client_id, date, status, created_at, updated_at)
         VALUES ('s1', 'c1', '2026-03-02', 'COMPLETED', '2026-01-02T00:00:00', '2026-01-02T00:00:00');
         INSERT INTO products (id, name, lot_number, expiration_date, single_use, created_at, updated_at)
         VALUES ('p1', 'Aiguille', 'N-1', '2030-01-01', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00'),
                ('p2', 'Encre noire', 'E-7', '2030-01-01', 0, '2026-01-01T00:00:00', '2026-01-01T00:00:00');
         INSERT INTO session_products (session_id, product_id, created_at)
         VALUES ('s1', 'p1', '2026-03-02T10:00:00'), ('s1', 'p2', '2026-03-02T10:00:00');",
    )
    .execute(&pool)
    .await
    .unwrap();
    for name in [
        "006_lots_and_stock.sql",
        "007_session_usage_voids.sql",
        "008_session_paperwork.sql",
        "009_appointments_and_billing.sql",
    ] {
        run(&pool, name).await.unwrap();
    }
    pool
}

#[tokio::test]
async fn legacy_tables_are_dropped_once_everything_was_copied() {
    let pool = legacy_database().await;
    run(&pool, "010_drop_legacy_products.sql").await.unwrap();

    assert!(!table_exists(&pool, "products").await);
    assert!(!table_exists(&pool, "session_products").await);
    let usages: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM session_usages WHERE session_id = 's1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(usages, 2);
    let check: Vec<String> = sqlx::query_scalar("PRAGMA foreign_key_check")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(check.is_empty());
}

#[tokio::test]
async fn nothing_is_dropped_when_a_legacy_link_has_no_equivalent() {
    let pool = legacy_database().await;
    // Fiche ajoutée par une version de transition, jamais recopiée dans les lots.
    sqlx::raw_sql(
        "INSERT INTO products (id, name, lot_number, expiration_date, single_use, created_at, updated_at)
         VALUES ('p3', 'Encre rouge', 'R-2', '2030-01-01', 0, '2026-01-01T00:00:00', '2026-01-01T00:00:00');",
    )
    .execute(&pool)
    .await
    .unwrap();

    let error = run(&pool, "010_drop_legacy_products.sql")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Migration 010"));
    assert!(table_exists(&pool, "products").await);
    assert!(table_exists(&pool, "session_products").await);
}

#[tokio::test]
async fn a_new_install_has_no_legacy_tables() {
    let pool = pool().await;
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    assert!(!table_exists(&pool, "products").await);
}

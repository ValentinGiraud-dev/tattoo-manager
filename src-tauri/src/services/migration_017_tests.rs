//! La migration 017 pose un titre aux séances déjà liées à un projet.

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

async fn run(pool: &SqlitePool, name: &str) {
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    sqlx::raw_sql(&migration(name))
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn linked_sessions_receive_a_numbered_title() {
    let pool = pool().await;
    for name in [
        "001_clients.sql",
        "002_sessions.sql",
        "003_products.sql",
        "004_session_products.sql",
        "005_session_indexes.sql",
        "006_lots_and_stock.sql",
        "007_session_usage_voids.sql",
        "008_session_paperwork.sql",
        "009_appointments_and_billing.sql",
        "010_drop_legacy_products.sql",
        "011_product_categories.sql",
        "012_audit_log.sql",
        "013_product_sheets.sql",
        "014_low_stock.sql",
        "015_client_archives.sql",
        "016_archives.sql",
    ] {
        run(&pool, name).await;
    }

    sqlx::raw_sql(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Léa', 'Martin', '2026-01-01T00:00:00', '2026-01-01T00:00:00'),
                ('c2', 'Nina', 'Martin', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
         INSERT INTO projects (id, client_id, title, status, created_at, updated_at)
         VALUES ('p1', 'c1', 'Arbre', 'ACTIVE', '2026-01-01T00:00:00', '2026-01-01T00:00:00'),
                ('p2', 'c2', 'Lune', 'ACTIVE', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
         INSERT INTO sessions (id, client_id, project_id, date, status, created_at, updated_at)
         VALUES
            ('s-late', 'c1', 'p1', '2026-03-01', 'PLANNED', '2026-03-01T00:00:00', '2026-03-01T00:00:00'),
            ('s-early', 'c1', 'p1', '2026-01-15', 'PLANNED', '2026-01-15T00:00:00', '2026-01-15T00:00:00'),
            ('s-same', 'c1', 'p1', '2026-01-15', 'PLANNED', '2026-01-15T01:00:00', '2026-01-15T01:00:00'),
            ('s-alone', 'c1', NULL, '2026-04-01', 'PLANNED', '2026-04-01T00:00:00', '2026-04-01T00:00:00'),
            ('s-archived-client', 'c2', 'p2', '2026-02-01', 'PLANNED', '2026-02-01T00:00:00', '2026-02-01T00:00:00');
         UPDATE clients SET archived_at = '2026-05-01T00:00:00' WHERE id = 'c2';",
    )
    .execute(&pool)
    .await
    .unwrap();

    run(&pool, "017_session_title.sql").await;

    let title = |id: &str| {
        let pool = &pool;
        let id = id.to_string();
        async move {
            sqlx::query_scalar::<_, Option<String>>("SELECT title FROM sessions WHERE id = ?")
                .bind(id)
                .fetch_one(pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(title("s-early").await.as_deref(), Some("Arbre séance 1"));
    assert_eq!(title("s-same").await.as_deref(), Some("Arbre séance 2"));
    assert_eq!(title("s-late").await.as_deref(), Some("Arbre séance 3"));
    assert_eq!(title("s-alone").await.as_deref(), None);
    assert_eq!(
        title("s-archived-client").await.as_deref(),
        Some("Lune séance 1")
    );

    let error = sqlx::query("UPDATE sessions SET notes = 'x' WHERE id = 's-archived-client'")
        .execute(&pool)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Client archivé"), "{error}");
}

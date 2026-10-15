//! La migration 009 reconstruit la table sessions : les séances existantes et tout ce
//! qui pointe vers elles (produits, mouvements, formulaires, documents) doivent survivre.

use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Connection, SqlitePool};

fn migration(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("migrations")
        .join(name);
    std::fs::read_to_string(path).unwrap()
}

/// id, date, statut, zone, notes, création, modification.
type SessionRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
);

const BEFORE_009: [&str; 8] = [
    "001_clients.sql",
    "002_sessions.sql",
    "003_products.sql",
    "004_session_products.sql",
    "005_session_indexes.sql",
    "006_lots_and_stock.sql",
    "007_session_usage_voids.sql",
    "008_session_paperwork.sql",
];

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

/// Exécute la 009 comme sqlx : dans une transaction.
async fn run_009(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let mut conn = pool.acquire().await?;
    let mut tx = conn.begin().await?;
    sqlx::raw_sql(&migration("009_appointments_and_billing.sql"))
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

async fn seed_v8(pool: &SqlitePool) {
    for name in BEFORE_009 {
        sqlx::raw_sql(&migration(name)).execute(pool).await.unwrap();
    }
    sqlx::raw_sql(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Léa', 'Martin', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
         INSERT INTO sessions (id, client_id, date, status, body_area, notes, created_at, updated_at)
         VALUES ('s1', 'c1', '2026-03-02', 'COMPLETED', 'Épaule', 'Première séance',
                 '2026-01-02T00:00:00', '2026-01-03T00:00:00'),
                ('s2', 'c1', '2026-04-02', 'PLANNED', NULL, NULL,
                 '2026-01-04T00:00:00', '2026-01-04T00:00:00');
         INSERT INTO lots (id, name, lot_number, expiration_date, single_use, created_at, updated_at)
         VALUES ('l1', 'Aiguille', 'N-1', '2030-01-01', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00');
         INSERT INTO stock_movements (id, lot_id, type, quantity, created_at)
         VALUES ('m1', 'l1', 'PURCHASE', 10, '2026-01-01T00:00:00');
         INSERT INTO stock_movements (id, lot_id, session_id, type, quantity, created_at)
         VALUES ('m2', 'l1', 's1', 'CONSUMPTION', -2, '2026-03-02T10:00:00');
         INSERT INTO session_usages (id, session_id, lot_id, created_at)
         VALUES ('u1', 's1', 'l1', '2026-03-02T10:00:00');
         INSERT INTO session_forms (id, session_id, kind, form_version, answers, created_at, updated_at)
         VALUES ('f1', 's1', 'HEALTH', 1, '{}', '2026-03-02T09:00:00', '2026-03-02T09:00:00');
         INSERT INTO session_documents (id, session_id, kind, stored_name, original_name, size_bytes, created_at)
         VALUES ('d1', 's1', 'HEALTH_SIGNED', 'd1.pdf', 'scan.pdf', 10, '2026-03-02T11:00:00');",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn existing_sessions_and_their_links_survive_the_rebuild() {
    let pool = pool().await;
    seed_v8(&pool).await;
    run_009(&pool).await.unwrap();

    let rows: Vec<SessionRow> = sqlx::query_as(
        "SELECT id, date, status, body_area, notes, created_at, updated_at
         FROM sessions ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0],
        (
            "s1".into(),
            "2026-03-02".into(),
            "COMPLETED".into(),
            Some("Épaule".into()),
            Some("Première séance".into()),
            "2026-01-02T00:00:00".into(),
            "2026-01-03T00:00:00".into()
        )
    );
    let new_columns: (Option<String>, Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT project_id, start_time, duration_minutes, price_cents FROM sessions WHERE id = 's1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(new_columns, (None, None, None, None));

    for (table, expected) in [
        ("session_usages", 1),
        ("stock_movements", 2),
        ("session_forms", 1),
        ("session_documents", 1),
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, expected, "{table}");
    }

    let violations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(violations, 0);
    let indexes: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions' ORDER BY name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(indexes.contains(&"idx_sessions_client_id".to_string()));
    assert!(indexes.contains(&"idx_sessions_date".to_string()));
}

#[tokio::test]
async fn foreign_keys_still_protect_sessions_after_the_rebuild() {
    let pool = pool().await;
    seed_v8(&pool).await;
    run_009(&pool).await.unwrap();

    // Une référence vers une séance inexistante est toujours refusée.
    let orphan = sqlx::query(
        "INSERT INTO session_usages (id, session_id, lot_id, created_at)
         VALUES ('u2', 'inconnue', 'l1', '2026-05-01T00:00:00')",
    )
    .execute(&pool)
    .await;
    assert!(orphan.is_err());

    // Le nouveau statut est accepté, un statut inconnu non.
    sqlx::query("UPDATE sessions SET status = 'NO_SHOW' WHERE id = 's2'")
        .execute(&pool)
        .await
        .unwrap();
    let invalid = sqlx::query("UPDATE sessions SET status = 'LATE' WHERE id = 's2'")
        .execute(&pool)
        .await;
    assert!(invalid.is_err());
}

#[tokio::test]
async fn a_broken_reference_stops_the_migration_and_leaves_the_base_unchanged() {
    let pool = pool().await;
    seed_v8(&pool).await;
    // Simule une base abîmée : un lien vers une séance qui n'existe pas.
    sqlx::raw_sql(
        "PRAGMA foreign_keys = OFF;
         INSERT INTO session_usages (id, session_id, lot_id, created_at)
         VALUES ('orphan', 'disparue', 'l1', '2026-05-01T00:00:00');
         PRAGMA foreign_keys = ON;",
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(run_009(&pool).await.is_err());
    let projects: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'projects'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(projects, 0);
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sessions, 2);
}

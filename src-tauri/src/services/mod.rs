use sqlx::SqlitePool;

pub mod clients;
pub mod products;
pub mod session_products;
pub mod sessions;

pub async fn applied_migration_count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
}

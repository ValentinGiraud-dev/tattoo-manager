use sqlx::SqlitePool;

pub mod clients;
pub mod error;
pub mod lots;
pub mod session_usages;
pub mod sessions;
pub mod sql;
pub mod stock;
pub mod units;

#[cfg(test)]
mod stock_rules_tests;

pub async fn applied_migration_count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
}

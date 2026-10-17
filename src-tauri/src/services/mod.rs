use sqlx::SqlitePool;

pub mod billing;
pub mod clients;
pub mod dashboard;
pub mod error;
pub mod expiry;
pub mod exports;
pub mod form_pdf;
pub mod lots;
pub mod paperwork;
pub mod projects;
pub mod session_usages;
pub mod sessions;
pub mod sql;
pub mod stock;
pub mod units;

#[cfg(test)]
mod appointments_tests;
#[cfg(test)]
mod dashboard_tests;
#[cfg(test)]
mod migration_009_tests;
#[cfg(test)]
mod migration_010_tests;
#[cfg(test)]
mod paperwork_tests;
#[cfg(test)]
mod stock_rules_tests;
#[cfg(test)]
mod traceability_tests;

pub async fn applied_migration_count(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
}

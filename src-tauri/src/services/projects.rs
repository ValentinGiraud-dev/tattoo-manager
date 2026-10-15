//! Projets : une pièce réalisée en une ou plusieurs séances, avec son devis et ses acomptes.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::error::LotError;
use super::sessions::MAX_PRICE_CENTS;
use super::sql::{clean, NOW};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectStatus {
    /// En cours.
    Active,
    /// Pièce terminée.
    Completed,
    /// Abandonné par le client ou l'atelier.
    Abandoned,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub client_id: String,
    pub title: String,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub quoted_price_cents: Option<i64>,
    pub status: ProjectStatus,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub client_id: String,
    pub client_first_name: String,
    pub client_last_name: String,
    pub title: String,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub quoted_price_cents: Option<i64>,
    pub status: ProjectStatus,
    pub created_at: String,
    pub updated_at: String,
    /// Séances rattachées (tous statuts).
    pub session_count: i64,
    pub completed_count: i64,
    /// Prochaine séance prévue (aujourd'hui ou plus tard).
    pub next_session_date: Option<String>,
    /// Somme des prix des séances prévues ou faites.
    pub sessions_price_cents: i64,
    /// Acomptes versés en attente (ni déduits, ni perdus, ni remboursés).
    pub held_deposits_cents: i64,
    /// Encaissé : acomptes non annulés et non remboursés + paiements non annulés.
    pub received_cents: i64,
}

const SUMMARY_SELECT: &str = "SELECT
    p.id, p.client_id, c.first_name AS client_first_name, c.last_name AS client_last_name,
    p.title, p.body_area, p.description, p.quoted_price_cents, p.status,
    p.created_at, p.updated_at,
    (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id) AS session_count,
    (SELECT COUNT(*) FROM sessions s WHERE s.project_id = p.id AND s.status = 'COMPLETED')
        AS completed_count,
    (SELECT MIN(s.date) FROM sessions s
        WHERE s.project_id = p.id AND s.status = 'PLANNED' AND s.date >= ?1) AS next_session_date,
    COALESCE((SELECT SUM(s.price_cents) FROM sessions s
        WHERE s.project_id = p.id AND s.status IN ('PLANNED', 'COMPLETED')), 0)
        AS sessions_price_cents,
    COALESCE((SELECT SUM(d.amount_cents) FROM deposits d
        WHERE d.voided_at IS NULL
          AND (d.project_id = p.id
               OR d.session_id IN (SELECT id FROM sessions WHERE project_id = p.id))
          AND NOT EXISTS (SELECT 1 FROM deposit_outcomes o
                          WHERE o.deposit_id = d.id AND o.voided_at IS NULL)), 0)
        AS held_deposits_cents,
    COALESCE((SELECT SUM(d.amount_cents) FROM deposits d
        WHERE d.voided_at IS NULL
          AND (d.project_id = p.id
               OR d.session_id IN (SELECT id FROM sessions WHERE project_id = p.id))
          AND NOT EXISTS (SELECT 1 FROM deposit_outcomes o
                          WHERE o.deposit_id = d.id AND o.voided_at IS NULL
                            AND o.outcome = 'REFUNDED')), 0)
    + COALESCE((SELECT SUM(pa.amount_cents) FROM payments pa
        WHERE pa.voided_at IS NULL
          AND pa.session_id IN (SELECT id FROM sessions WHERE project_id = p.id)), 0)
        AS received_cents
 FROM projects p
 INNER JOIN clients c ON c.id = p.client_id";

fn today() -> String {
    super::expiry::today().format("%Y-%m-%d").to_string()
}

struct Normalized {
    client_id: String,
    title: String,
    body_area: Option<String>,
    description: Option<String>,
    quoted_price_cents: Option<i64>,
    status: ProjectStatus,
}

async fn normalize(pool: &SqlitePool, input: ProjectInput) -> Result<Normalized, LotError> {
    let client_id = input.client_id.trim().to_string();
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM clients WHERE id = ?")
        .bind(&client_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(LotError::Invalid("Le client est introuvable"));
    }
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(LotError::Invalid("Le titre du projet est obligatoire"));
    }
    if let Some(price) = input.quoted_price_cents {
        if !(0..=MAX_PRICE_CENTS).contains(&price) {
            return Err(LotError::Invalid("Le prix annoncé n'est pas valide"));
        }
    }
    Ok(Normalized {
        client_id,
        title,
        body_area: clean(input.body_area),
        description: clean(input.description),
        quoted_price_cents: input.quoted_price_cents,
        status: input.status,
    })
}

pub async fn get_project(pool: &SqlitePool, id: &str) -> Result<ProjectSummary, LotError> {
    let sql = format!("{SUMMARY_SELECT} WHERE p.id = ?2");
    sqlx::query_as::<_, ProjectSummary>(&sql)
        .bind(today())
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(LotError::NotFound)
}

/// Projets d'un client : en cours d'abord, puis les plus récents.
pub async fn list_client_projects(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<Vec<ProjectSummary>, LotError> {
    let sql = format!(
        "{SUMMARY_SELECT} WHERE p.client_id = ?2
         ORDER BY p.status != 'ACTIVE', p.created_at DESC"
    );
    Ok(sqlx::query_as::<_, ProjectSummary>(&sql)
        .bind(today())
        .bind(client_id)
        .fetch_all(pool)
        .await?)
}

pub async fn create_project(
    pool: &SqlitePool,
    input: ProjectInput,
) -> Result<ProjectSummary, LotError> {
    let input = normalize(pool, input).await?;
    let sql = format!(
        "INSERT INTO projects
            (id, client_id, title, body_area, description, quoted_price_cents, status,
             created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
         RETURNING id"
    );
    let id: String = sqlx::query_scalar(&sql)
        .bind(&input.client_id)
        .bind(&input.title)
        .bind(&input.body_area)
        .bind(&input.description)
        .bind(input.quoted_price_cents)
        .bind(input.status)
        .fetch_one(pool)
        .await?;
    get_project(pool, &id).await
}

pub const PROJECT_CLIENT_LOCKED: &str =
    "Ce projet a déjà des séances ou des acomptes : il ne peut plus changer de client.";

pub async fn update_project(
    pool: &SqlitePool,
    id: &str,
    input: ProjectInput,
) -> Result<ProjectSummary, LotError> {
    let input = normalize(pool, input).await?;
    let current = get_project(pool, id).await?;
    if current.client_id != input.client_id {
        let deposits: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM deposits WHERE project_id = ?")
                .bind(id)
                .fetch_one(pool)
                .await?;
        if current.session_count > 0 || deposits > 0 {
            return Err(LotError::Invalid(PROJECT_CLIENT_LOCKED));
        }
    }
    let sql = format!(
        "UPDATE projects
         SET client_id = ?, title = ?, body_area = ?, description = ?, quoted_price_cents = ?,
             status = ?, updated_at = {NOW}
         WHERE id = ?"
    );
    sqlx::query(&sql)
        .bind(&input.client_id)
        .bind(&input.title)
        .bind(&input.body_area)
        .bind(&input.description)
        .bind(input.quoted_price_cents)
        .bind(input.status)
        .bind(id)
        .execute(pool)
        .await?;
    get_project(pool, id).await
}

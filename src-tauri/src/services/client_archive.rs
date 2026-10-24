//! Archivage d'un client : lecture seule, masqué des listes, stock rétabli.
//!
//! Rien n'est effacé. Pour chaque lot à usage unique, la consommation nette des
//! séances du client est remise en stock par un ADJUSTMENT sans séance, relié à
//! l'archive. Le désarchivage ajoute les mouvements inverses.

use serde::Serialize;
use sqlx::{Sqlite, SqlitePool, Transaction};

use super::archive;
use super::error::LotError;
use super::sql::{log_database_error, DATABASE_MESSAGE, NOW};
use super::stock::{apply_movement, MovementDraft, MovementType};

#[derive(Debug)]
pub enum ArchiveError {
    Invalid(String),
    NotFound,
    Database,
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Client introuvable"),
            Self::Database => write!(f, "{DATABASE_MESSAGE}"),
        }
    }
}

impl From<sqlx::Error> for ArchiveError {
    fn from(error: sqlx::Error) -> Self {
        log_database_error(&error);
        Self::Database
    }
}

impl From<LotError> for ArchiveError {
    fn from(error: LotError) -> Self {
        match error {
            LotError::Database => Self::Database,
            other => Self::Invalid(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSession {
    pub id: String,
    pub date: String,
    pub body_area: Option<String>,
    pub status: String,
    /// Séance prévue, à partir d'aujourd'hui : elle quitte le planning.
    pub upcoming: bool,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProject {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveStock {
    pub lot_id: String,
    pub name: String,
    pub lot_number: String,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreview {
    pub client_id: String,
    pub archived: bool,
    /// Vrai si le client n'est relié à rien : il peut être supprimé.
    pub can_delete: bool,
    pub sessions: Vec<ArchiveSession>,
    pub projects: Vec<ArchiveProject>,
    pub deposit_count: i64,
    pub payment_count: i64,
    pub document_count: i64,
    /// Stock remis (archivage) ou re-décompté (désarchivage), par lot.
    pub stock: Vec<ArchiveStock>,
}

async fn client_state(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<(String, Option<String>), ArchiveError> {
    sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT first_name || ' ' || last_name, archived_at FROM clients WHERE id = ?",
    )
    .bind(client_id)
    .fetch_optional(pool)
    .await?
    .ok_or(ArchiveError::NotFound)
}

const NET_CONSUMPTION_SQL: &str = "SELECT l.id AS lot_id, l.name, l.lot_number,
        -SUM(m.quantity) AS quantity
     FROM stock_movements m
     INNER JOIN lots l ON l.id = m.lot_id
     WHERE l.single_use = 1
       AND m.session_id IN (SELECT id FROM sessions WHERE client_id = ?)
     GROUP BY l.id
     HAVING -SUM(m.quantity) > 0
     ORDER BY l.name COLLATE NOCASE, l.lot_number";

/// Ce que l'archivage (ou le désarchivage) touche, pour l'afficher avant de confirmer.
pub async fn archive_preview(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<ArchivePreview, ArchiveError> {
    let (_, archived_at) = client_state(pool, client_id).await?;

    let today = super::expiry::today().format("%Y-%m-%d").to_string();
    let sessions = sqlx::query_as::<_, ArchiveSession>(
        "SELECT id, date, body_area, status,
                (status = 'PLANNED' AND date >= ?1) AS upcoming
         FROM sessions WHERE client_id = ?2 ORDER BY date DESC",
    )
    .bind(&today)
    .bind(client_id)
    .fetch_all(pool)
    .await?;
    let projects = sqlx::query_as::<_, ArchiveProject>(
        "SELECT id, title FROM projects WHERE client_id = ? ORDER BY title COLLATE NOCASE",
    )
    .bind(client_id)
    .fetch_all(pool)
    .await?;
    let deposit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM deposits WHERE client_id = ?")
            .bind(client_id)
            .fetch_one(pool)
            .await?;
    let payment_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM payments
         WHERE session_id IN (SELECT id FROM sessions WHERE client_id = ?)",
    )
    .bind(client_id)
    .fetch_one(pool)
    .await?;
    let document_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session_documents
         WHERE session_id IN (SELECT id FROM sessions WHERE client_id = ?)",
    )
    .bind(client_id)
    .fetch_one(pool)
    .await?;

    let stock = if archived_at.is_some() {
        sqlx::query_as::<_, ArchiveStock>(
            "SELECT l.id AS lot_id, l.name, l.lot_number, SUM(am.quantity) AS quantity
             FROM client_archive_movements am
             INNER JOIN client_archives a ON a.id = am.archive_id
             INNER JOIN lots l ON l.id = am.lot_id
             WHERE a.client_id = ? AND a.restored_at IS NULL
             GROUP BY l.id ORDER BY l.name COLLATE NOCASE",
        )
        .bind(client_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, ArchiveStock>(NET_CONSUMPTION_SQL)
            .bind(client_id)
            .fetch_all(pool)
            .await?
    };

    let can_delete =
        sessions.is_empty() && projects.is_empty() && deposit_count == 0 && archived_at.is_none();
    Ok(ArchivePreview {
        client_id: client_id.to_string(),
        archived: archived_at.is_some(),
        can_delete,
        sessions,
        projects,
        deposit_count,
        payment_count,
        document_count,
        stock,
    })
}

async fn last_movement_id(
    tx: &mut Transaction<'_, Sqlite>,
    lot_id: &str,
) -> Result<String, ArchiveError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM stock_movements WHERE lot_id = ? ORDER BY rowid DESC LIMIT 1",
    )
    .bind(lot_id)
    .fetch_one(&mut **tx)
    .await?)
}

pub async fn archive_client(pool: &SqlitePool, client_id: &str) -> Result<(), ArchiveError> {
    let mut tx = pool.begin().await?;
    let state: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT first_name || ' ' || last_name, archived_at FROM clients WHERE id = ?",
    )
    .bind(client_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((name, archived_at)) = state else {
        return Err(ArchiveError::NotFound);
    };
    if archived_at.is_some() {
        return Err(ArchiveError::Invalid("Ce client est déjà archivé".into()));
    }
    let linked: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM sessions WHERE client_id = ?1)
              + (SELECT COUNT(*) FROM projects WHERE client_id = ?1)
              + (SELECT COUNT(*) FROM deposits WHERE client_id = ?1)",
    )
    .bind(client_id)
    .fetch_one(&mut *tx)
    .await?;
    if linked == 0 {
        return Err(ArchiveError::Invalid(
            "Rien n'est relié à ce client : supprime-le.".into(),
        ));
    }

    let stock = sqlx::query_as::<_, ArchiveStock>(NET_CONSUMPTION_SQL)
        .bind(client_id)
        .fetch_all(&mut *tx)
        .await?;

    let archive_id: String = sqlx::query_scalar(&format!(
        "INSERT INTO client_archives (id, client_id, archived_at)
         VALUES (lower(hex(randomblob(16))), ?, {NOW}) RETURNING id"
    ))
    .bind(client_id)
    .fetch_one(&mut *tx)
    .await?;

    archive::begin_lot_movement(&mut tx).await?;
    for line in &stock {
        apply_movement(
            &mut tx,
            MovementDraft {
                lot_id: line.lot_id.clone(),
                unit_id: None,
                session_id: None,
                movement_type: MovementType::Adjustment,
                quantity: line.quantity,
                reason: Some(format!("Archivage du client {name}")),
            },
        )
        .await?;
        let movement_id = last_movement_id(&mut tx, &line.lot_id).await?;
        sqlx::query(
            "INSERT INTO client_archive_movements (id, archive_id, lot_id, quantity, movement_id)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)",
        )
        .bind(&archive_id)
        .bind(&line.lot_id)
        .bind(line.quantity)
        .bind(&movement_id)
        .execute(&mut *tx)
        .await?;
    }
    archive::end_lot_movement(&mut tx).await?;

    sqlx::query(&format!(
        "UPDATE clients SET archived_at = {NOW}, updated_at = {NOW} WHERE id = ?"
    ))
    .bind(client_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn restore_client(pool: &SqlitePool, client_id: &str) -> Result<(), ArchiveError> {
    let mut tx = pool.begin().await?;
    let state: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT first_name || ' ' || last_name, archived_at FROM clients WHERE id = ?",
    )
    .bind(client_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((name, archived_at)) = state else {
        return Err(ArchiveError::NotFound);
    };
    if archived_at.is_none() {
        return Err(ArchiveError::Invalid("Ce client n'est pas archivé".into()));
    }
    let archive_id: String = sqlx::query_scalar(
        "SELECT id FROM client_archives WHERE client_id = ? AND restored_at IS NULL",
    )
    .bind(client_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ArchiveError::Invalid("Archive introuvable".into()))?;

    // Refus global, avec la liste des lots en défaut, avant de toucher au stock.
    let short: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT l.name, l.lot_number, SUM(am.quantity) AS needed,
                COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE lot_id = l.id), 0)
         FROM client_archive_movements am
         INNER JOIN lots l ON l.id = am.lot_id
         WHERE am.archive_id = ?
         GROUP BY l.id
         HAVING COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE lot_id = l.id), 0)
                < SUM(am.quantity)",
    )
    .bind(&archive_id)
    .fetch_all(&mut *tx)
    .await?;
    if !short.is_empty() {
        let lots = short
            .iter()
            .map(|(lot, number, needed, available)| {
                format!("{lot} (lot {number}) : {needed} nécessaires, {available} en stock")
            })
            .collect::<Vec<_>>()
            .join(" ; ");
        return Err(ArchiveError::Invalid(format!(
            "Désarchivage impossible, le stock est insuffisant : {lots}"
        )));
    }

    let lines: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT id, lot_id, quantity FROM client_archive_movements WHERE archive_id = ?",
    )
    .bind(&archive_id)
    .fetch_all(&mut *tx)
    .await?;
    archive::begin_lot_movement(&mut tx).await?;
    for (line_id, lot_id, quantity) in lines {
        apply_movement(
            &mut tx,
            MovementDraft {
                lot_id: lot_id.clone(),
                unit_id: None,
                session_id: None,
                movement_type: MovementType::Adjustment,
                quantity: -quantity,
                reason: Some(format!("Désarchivage du client {name}")),
            },
        )
        .await?;
        let movement_id = last_movement_id(&mut tx, &lot_id).await?;
        sqlx::query("UPDATE client_archive_movements SET restore_movement_id = ? WHERE id = ?")
            .bind(&movement_id)
            .bind(&line_id)
            .execute(&mut *tx)
            .await?;
    }
    archive::end_lot_movement(&mut tx).await?;

    sqlx::query(&format!(
        "UPDATE client_archives SET restored_at = {NOW} WHERE id = ?"
    ))
    .bind(&archive_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!(
        "UPDATE clients SET archived_at = NULL, updated_at = {NOW} WHERE id = ?"
    ))
    .bind(client_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

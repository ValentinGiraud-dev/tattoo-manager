use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::error::LotError;
use super::sql::{self, NOW};
use super::stock::{self, MovementDraft, MovementType};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageItem {
    pub id: String,
    pub session_id: String,
    pub lot_id: Option<String>,
    pub unit_id: Option<String>,
    pub created_at: String,
    pub name: String,
    pub lot_number: String,
    pub expiration_date: String,
    pub single_use: bool,
    pub opened_at: Option<String>,
    pub quantity: i64,
    pub expired: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LotSessionItem {
    pub session_id: String,
    pub lot_id: Option<String>,
    pub unit_id: Option<String>,
    pub created_at: String,
    pub date: String,
    pub status: String,
    pub body_area: Option<String>,
    pub client_first_name: String,
    pub client_last_name: String,
    pub quantity: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LinkableItem {
    pub lot_id: String,
    pub unit_id: Option<String>,
    pub name: String,
    pub lot_number: String,
    pub expiration_date: String,
    pub single_use: bool,
    pub stock: i64,
    pub opened_at: Option<String>,
    pub expired: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSessionInput {
    pub session_id: String,
    pub lot_id: Option<String>,
    pub unit_id: Option<String>,
    pub quantity: Option<i64>,
}

const USAGE_SELECT: &str = r#"
SELECT
    su.id,
    su.session_id,
    su.lot_id,
    su.unit_id,
    su.created_at,
    l.name,
    l.lot_number,
    l.expiration_date,
    l.single_use,
    u.opened_at,
    CASE
        WHEN su.lot_id IS NOT NULL THEN COALESCE((
            SELECT SUM(-m.quantity)
            FROM stock_movements m
            WHERE m.session_id = su.session_id
              AND m.lot_id = su.lot_id
              AND m.unit_id IS NULL
              AND m.type IN ('CONSUMPTION', 'ADJUSTMENT')
        ), 0)
        ELSE 0
    END AS quantity,
    CASE WHEN l.expiration_date < date('now') THEN 1 ELSE 0 END AS expired
FROM session_usages su
LEFT JOIN units u ON u.id = su.unit_id
INNER JOIN lots l ON l.id = COALESCE(su.lot_id, u.lot_id)
"#;

async fn ensure_session(pool: &SqlitePool, session_id: &str) -> Result<(), LotError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM sessions WHERE id = ? LIMIT 1")
        .bind(session_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(LotError::Invalid("La séance est introuvable"));
    }
    Ok(())
}

pub async fn list_session_usages(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<SessionUsageItem>, LotError> {
    ensure_session(pool, session_id).await?;
    let sql = format!(
        "{USAGE_SELECT}
         WHERE su.session_id = ?
         ORDER BY su.created_at ASC, l.name COLLATE NOCASE"
    );
    let items = sqlx::query_as::<_, SessionUsageItem>(&sql)
        .bind(session_id)
        .fetch_all(pool)
        .await?;
    Ok(items)
}

pub async fn list_lot_sessions(
    pool: &SqlitePool,
    lot_id: &str,
) -> Result<Vec<LotSessionItem>, LotError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM lots WHERE id = ? LIMIT 1")
        .bind(lot_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(LotError::NotFound);
    }
    let items = sqlx::query_as::<_, LotSessionItem>(
        "SELECT
            su.session_id,
            su.lot_id,
            su.unit_id,
            su.created_at,
            s.date,
            s.status,
            s.body_area,
            c.first_name AS client_first_name,
            c.last_name AS client_last_name,
            CASE
                WHEN su.lot_id IS NOT NULL THEN COALESCE((
                    SELECT SUM(-m.quantity)
                    FROM stock_movements m
                    WHERE m.session_id = su.session_id
                      AND m.lot_id = su.lot_id
                      AND m.unit_id IS NULL
                      AND m.type IN ('CONSUMPTION', 'ADJUSTMENT')
                ), 0)
                ELSE 0
            END AS quantity
         FROM session_usages su
         INNER JOIN sessions s ON s.id = su.session_id
         INNER JOIN clients c ON c.id = s.client_id
         LEFT JOIN units u ON u.id = su.unit_id
         WHERE su.lot_id = ?1 OR u.lot_id = ?1
         ORDER BY s.date DESC, su.created_at DESC",
    )
    .bind(lot_id)
    .fetch_all(pool)
    .await?;
    Ok(items)
}

pub async fn list_linkable(
    pool: &SqlitePool,
    session_id: &str,
    search: Option<String>,
) -> Result<Vec<LinkableItem>, LotError> {
    ensure_session(pool, session_id).await?;
    let pattern = sql::like_pattern(search);
    let items = sqlx::query_as::<_, LinkableItem>(
        "SELECT * FROM (
            SELECT
                l.id AS lot_id,
                CAST(NULL AS TEXT) AS unit_id,
                l.name,
                l.lot_number,
                l.expiration_date,
                l.single_use,
                COALESCE((
                    SELECT SUM(m.quantity) FROM stock_movements m WHERE m.lot_id = l.id
                ), 0) AS stock,
                CAST(NULL AS TEXT) AS opened_at,
                CASE WHEN l.expiration_date < date('now') THEN 1 ELSE 0 END AS expired
            FROM lots l
            WHERE l.single_use = 1
              AND COALESCE((
                  SELECT SUM(m.quantity) FROM stock_movements m WHERE m.lot_id = l.id
              ), 0) > 0
              AND (
                  ?2 IS NULL
                  OR l.name LIKE ?2 ESCAPE '\\'
                  OR l.lot_number LIKE ?2 ESCAPE '\\'
              )
            UNION ALL
            SELECT
                l.id AS lot_id,
                u.id AS unit_id,
                l.name,
                l.lot_number,
                l.expiration_date,
                l.single_use,
                1 AS stock,
                u.opened_at,
                CASE WHEN l.expiration_date < date('now') THEN 1 ELSE 0 END AS expired
            FROM units u
            INNER JOIN lots l ON l.id = u.lot_id
            WHERE l.single_use = 0
              AND COALESCE((
                  SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id
              ), 0) > 0
              AND u.id NOT IN (
                  SELECT unit_id FROM session_usages
                  WHERE session_id = ?1 AND unit_id IS NOT NULL
              )
              AND (
                  ?2 IS NULL
                  OR l.name LIKE ?2 ESCAPE '\\'
                  OR l.lot_number LIKE ?2 ESCAPE '\\'
              )
        )
        ORDER BY name COLLATE NOCASE, lot_number COLLATE NOCASE, opened_at IS NULL, opened_at",
    )
    .bind(session_id)
    .bind(pattern)
    .fetch_all(pool)
    .await?;
    Ok(items)
}

pub async fn link_session(
    pool: &SqlitePool,
    input: LinkSessionInput,
) -> Result<SessionUsageItem, LotError> {
    let session_id = input.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(LotError::Invalid("La séance est obligatoire"));
    }
    let lot_id = sql::clean(input.lot_id);
    let unit_id = sql::clean(input.unit_id);
    match (&lot_id, &unit_id) {
        (Some(_), None) | (None, Some(_)) => {}
        _ => {
            return Err(LotError::Invalid(
                "Il faut un lot ou une pièce, pas les deux",
            ));
        }
    }

    let mut tx = pool.begin().await?;
    let session_exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sessions WHERE id = ? LIMIT 1")
            .bind(&session_id)
            .fetch_optional(&mut *tx)
            .await?;
    if session_exists.is_none() {
        return Err(LotError::Invalid("La séance est introuvable"));
    }

    let usage_id = if let Some(unit_id) = unit_id {
        let row: Option<(String, bool, i64)> = sqlx::query_as(
            "SELECT u.lot_id, l.single_use,
                    COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id), 0)
             FROM units u
             INNER JOIN lots l ON l.id = u.lot_id
             WHERE u.id = ?",
        )
        .bind(&unit_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((_lot_id, single_use, stock)) = row else {
            return Err(LotError::Invalid("La pièce est introuvable"));
        };
        if single_use {
            return Err(LotError::Invalid("Un usage unique se lie par le lot"));
        }
        if stock <= 0 {
            return Err(LotError::Invalid("Cette pièce n'est plus en stock"));
        }
        let already: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM session_usages WHERE session_id = ? AND unit_id = ? LIMIT 1",
        )
        .bind(&session_id)
        .bind(&unit_id)
        .fetch_optional(&mut *tx)
        .await?;
        if already.is_some() {
            return Err(LotError::AlreadyLinked);
        }
        let sql = format!(
            "INSERT INTO session_usages (id, session_id, lot_id, unit_id, created_at)
             VALUES (lower(hex(randomblob(16))), ?, NULL, ?, {NOW})
             RETURNING id"
        );
        let id: String = sqlx::query_scalar(&sql)
            .bind(&session_id)
            .bind(&unit_id)
            .fetch_one(&mut *tx)
            .await?;
        id
    } else {
        let lot_id = lot_id.expect("lot présent");
        let single_use: Option<bool> =
            sqlx::query_scalar("SELECT single_use FROM lots WHERE id = ?")
                .bind(&lot_id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(single_use) = single_use else {
            return Err(LotError::Invalid("Le lot est introuvable"));
        };
        if !single_use {
            return Err(LotError::Invalid(
                "Un usage multiple se lie par la pièce",
            ));
        }
        let quantity = input.quantity.unwrap_or(0);
        if quantity <= 0 {
            return Err(LotError::Invalid(
                "La quantité consommée doit être positive",
            ));
        }
        stock::apply_movement(
            &mut tx,
            MovementDraft {
                lot_id: lot_id.clone(),
                unit_id: None,
                session_id: Some(session_id.clone()),
                movement_type: MovementType::Consumption,
                quantity: -quantity,
                reason: None,
            },
        )
        .await?;
        let existing: Option<String> =
            sqlx::query_scalar("SELECT id FROM session_usages WHERE session_id = ? AND lot_id = ?")
                .bind(&session_id)
                .bind(&lot_id)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(id) = existing {
            id
        } else {
            let sql = format!(
                "INSERT INTO session_usages (id, session_id, lot_id, unit_id, created_at)
                 VALUES (lower(hex(randomblob(16))), ?, ?, NULL, {NOW})
                 RETURNING id"
            );
            sqlx::query_scalar(&sql)
                .bind(&session_id)
                .bind(&lot_id)
                .fetch_one(&mut *tx)
                .await?
        }
    };

    tx.commit().await?;
    let sql = format!("{USAGE_SELECT} WHERE su.id = ?");
    sqlx::query_as::<_, SessionUsageItem>(&sql)
        .bind(usage_id)
        .fetch_one(pool)
        .await
        .map_err(LotError::from)
}

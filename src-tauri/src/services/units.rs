use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::error::LotError;
use super::expiry;
use super::sql::{self, NOW};
use super::stock::{self, MovementDraft, MovementType};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UnitView {
    pub id: String,
    pub lot_id: String,
    pub opened_at: Option<String>,
    pub in_stock: bool,
    pub exit_type: Option<String>,
    pub exit_movement_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// La pièce a servi dans au moins une séance.
    pub used_in_sessions: bool,
    #[serde(skip)]
    pub expiration_date: String,
    #[serde(skip)]
    pub after_opening_months: Option<i64>,
    /// Dernier jour d'utilisation (péremption ou ouverture + durée).
    #[sqlx(skip)]
    pub useful_until: String,
    #[sqlx(skip)]
    pub expired: bool,
}

impl UnitView {
    fn with_expiry(mut self, today: chrono::NaiveDate) -> Self {
        self.useful_until = expiry::useful_until(
            &self.expiration_date,
            self.opened_at.as_deref(),
            self.after_opening_months,
        );
        self.expired = expiry::is_expired(&self.useful_until, today);
        self
    }
}

const UNIT_SELECT: &str = r#"
SELECT
    u.id,
    u.lot_id,
    u.opened_at,
    CASE
        WHEN COALESCE((
            SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id
        ), 0) > 0 THEN 1
        ELSE 0
    END AS in_stock,
    (
        SELECT m.type
        FROM stock_movements m
        WHERE m.unit_id = u.id AND m.quantity < 0
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
    ) AS exit_type,
    (
        SELECT m.id
        FROM stock_movements m
        WHERE m.unit_id = u.id AND m.quantity < 0
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
    ) AS exit_movement_id,
    u.created_at,
    u.updated_at,
    EXISTS (SELECT 1 FROM session_usages su WHERE su.unit_id = u.id) AS used_in_sessions,
    l.expiration_date,
    l.after_opening_months
FROM units u
INNER JOIN lots l ON l.id = u.lot_id
"#;

pub async fn list_units(pool: &SqlitePool, lot_id: &str) -> Result<Vec<UnitView>, LotError> {
    let single_use: Option<bool> = sqlx::query_scalar("SELECT single_use FROM lots WHERE id = ?")
        .bind(lot_id)
        .fetch_optional(pool)
        .await?;
    let Some(single_use) = single_use else {
        return Err(LotError::NotFound);
    };
    if single_use {
        return Ok(Vec::new());
    }
    let sql = format!("{UNIT_SELECT} WHERE u.lot_id = ? ORDER BY u.created_at ASC, u.id ASC");
    let units = sqlx::query_as::<_, UnitView>(&sql)
        .bind(lot_id)
        .fetch_all(pool)
        .await?;
    let today = expiry::today();
    Ok(units
        .into_iter()
        .map(|unit| unit.with_expiry(today))
        .collect())
}

pub async fn open_unit(
    pool: &SqlitePool,
    unit_id: &str,
    opened_at: String,
) -> Result<UnitView, LotError> {
    let opened_at = opened_at.trim().to_string();
    if !sql::is_iso_date(&opened_at) {
        return Err(LotError::Invalid(
            "La date d'ouverture doit être au format AAAA-MM-JJ",
        ));
    }

    if opened_at.as_str() > expiry::today().format("%Y-%m-%d").to_string().as_str() {
        return Err(LotError::Invalid(
            "La date d'ouverture ne peut pas être dans le futur",
        ));
    }

    let row: Option<(String, bool, i64, Option<String>, bool)> = sqlx::query_as(
        "SELECT u.lot_id, l.single_use,
                COALESCE((SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id), 0),
                u.opened_at,
                EXISTS (SELECT 1 FROM session_usages su WHERE su.unit_id = u.id)
         FROM units u
         INNER JOIN lots l ON l.id = u.lot_id
         WHERE u.id = ?",
    )
    .bind(unit_id)
    .fetch_optional(pool)
    .await?;
    let Some((_lot_id, single_use, stock, current_opened_at, used)) = row else {
        return Err(LotError::NotFound);
    };
    // La date d'ouverture d'une pièce déjà utilisée détermine sa limite au moment
    // des séances passées : on peut la renseigner, pas la changer.
    if used
        && current_opened_at
            .as_deref()
            .is_some_and(|current| current != opened_at)
    {
        return Err(LotError::Invalid(
            "Cette pièce a déjà servi en séance : sa date d'ouverture ne peut plus changer",
        ));
    }
    if single_use {
        return Err(LotError::Invalid(
            "Un usage unique n'a pas de date d'ouverture",
        ));
    }
    if stock <= 0 {
        return Err(LotError::Invalid("Cette pièce n'est plus en stock"));
    }

    let sql = format!("UPDATE units SET opened_at = ?, updated_at = {NOW} WHERE id = ?");
    sqlx::query(&sql)
        .bind(&opened_at)
        .bind(unit_id)
        .execute(pool)
        .await?;

    let unit_sql = format!("{UNIT_SELECT} WHERE u.id = ?");
    let unit = sqlx::query_as::<_, UnitView>(&unit_sql)
        .bind(unit_id)
        .fetch_one(pool)
        .await?;
    Ok(unit.with_expiry(expiry::today()))
}

pub async fn exit_unit(
    pool: &SqlitePool,
    unit_id: &str,
    movement_type: &str,
) -> Result<UnitView, LotError> {
    let movement_type = MovementType::parse(movement_type.trim())?;
    if !matches!(
        movement_type,
        MovementType::Consumption
            | MovementType::Loss
            | MovementType::Expiration
            | MovementType::Return
    ) {
        return Err(LotError::Invalid(
            "Une pièce se sort en terminé, perdu, périmé ou renvoyé",
        ));
    }

    let mut tx = pool.begin().await?;
    let row: Option<(String, bool)> = sqlx::query_as(
        "SELECT u.lot_id, l.single_use
         FROM units u
         INNER JOIN lots l ON l.id = u.lot_id
         WHERE u.id = ?",
    )
    .bind(unit_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((lot_id, single_use)) = row else {
        return Err(LotError::NotFound);
    };
    if single_use {
        return Err(LotError::Invalid("Un usage unique n'a pas de pièce"));
    }

    stock::apply_movement(
        &mut tx,
        MovementDraft {
            lot_id,
            unit_id: Some(unit_id.to_string()),
            session_id: None,
            movement_type,
            quantity: -1,
            reason: None,
        },
    )
    .await?;
    tx.commit().await?;

    let unit_sql = format!("{UNIT_SELECT} WHERE u.id = ?");
    let unit = sqlx::query_as::<_, UnitView>(&unit_sql)
        .bind(unit_id)
        .fetch_one(pool)
        .await?;
    Ok(unit.with_expiry(expiry::today()))
}

use serde::Deserialize;
use sqlx::{Sqlite, Transaction};

use crate::models::StockMovement;

use super::archive::{CLIENT_LOCKED, LOT_LOCKED, SESSION_LOCKED};
use super::error::LotError;
use super::sql::NOW;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MovementType {
    Purchase,
    Consumption,
    Loss,
    Expiration,
    Return,
    Adjustment,
}

impl MovementType {
    pub fn parse(value: &str) -> Result<Self, LotError> {
        match value {
            "PURCHASE" => Ok(Self::Purchase),
            "CONSUMPTION" => Ok(Self::Consumption),
            "LOSS" => Ok(Self::Loss),
            "EXPIRATION" => Ok(Self::Expiration),
            "RETURN" => Ok(Self::Return),
            "ADJUSTMENT" => Ok(Self::Adjustment),
            _ => Err(LotError::Invalid("Type de mouvement inconnu")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Purchase => "PURCHASE",
            Self::Consumption => "CONSUMPTION",
            Self::Loss => "LOSS",
            Self::Expiration => "EXPIRATION",
            Self::Return => "RETURN",
            Self::Adjustment => "ADJUSTMENT",
        }
    }

    /// Quantité saisie par l'utilisateur : positive, sauf un ajustement qui est signé.
    pub fn stored_quantity(self, quantity: i64) -> Result<i64, LotError> {
        match self {
            Self::Purchase => {
                if quantity <= 0 {
                    return Err(LotError::Invalid("La quantité doit être positive"));
                }
                Ok(quantity)
            }
            Self::Consumption | Self::Loss | Self::Expiration | Self::Return => {
                if quantity <= 0 {
                    return Err(LotError::Invalid("La quantité doit être positive"));
                }
                Ok(-quantity)
            }
            Self::Adjustment => {
                if quantity == 0 {
                    return Err(LotError::Invalid("L'ajustement ne peut pas être nul"));
                }
                Ok(quantity)
            }
        }
    }
}

pub(crate) struct MovementDraft {
    pub lot_id: String,
    pub unit_id: Option<String>,
    pub session_id: Option<String>,
    pub movement_type: MovementType,
    pub quantity: i64,
    pub reason: Option<String>,
}

pub(crate) async fn apply_movement(
    tx: &mut Transaction<'_, Sqlite>,
    draft: MovementDraft,
) -> Result<(), LotError> {
    let row: Option<(bool, Option<String>)> =
        sqlx::query_as("SELECT single_use, archived_at FROM lots WHERE id = ?")
            .bind(&draft.lot_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some((single_use, archived_at)) = row else {
        return Err(LotError::Invalid("Le lot est introuvable"));
    };
    if archived_at.is_some() {
        let bypass: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM schema_flags WHERE name = 'lot_movement' LIMIT 1")
                .fetch_optional(&mut **tx)
                .await?;
        if bypass.is_none() {
            return Err(LotError::Invalid(LOT_LOCKED));
        }
    }
    if let Some(session_id) = &draft.session_id {
        let session: Option<(Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT s.archived_at, c.archived_at
             FROM sessions s JOIN clients c ON c.id = s.client_id WHERE s.id = ?",
        )
        .bind(session_id)
        .fetch_optional(&mut **tx)
        .await?;
        match session {
            Some((Some(_), _)) => return Err(LotError::Invalid(SESSION_LOCKED)),
            Some((_, Some(_))) => return Err(LotError::Invalid(CLIENT_LOCKED)),
            _ => {}
        }
    }

    if draft.movement_type == MovementType::Adjustment {
        let reason = draft.reason.as_deref().map(str::trim).unwrap_or("");
        if reason.is_empty() {
            return Err(LotError::Invalid("Un ajustement doit avoir une raison"));
        }
    }

    match draft.movement_type {
        MovementType::Purchase if draft.quantity <= 0 => {
            return Err(LotError::Invalid("La quantité doit être positive"));
        }
        MovementType::Consumption
        | MovementType::Loss
        | MovementType::Expiration
        | MovementType::Return
            if draft.quantity >= 0 =>
        {
            return Err(LotError::Invalid("La quantité doit être positive"));
        }
        MovementType::Adjustment if draft.quantity == 0 => {
            return Err(LotError::Invalid("L'ajustement ne peut pas être nul"));
        }
        _ => {}
    }

    if let Some(unit_id) = &draft.unit_id {
        if single_use {
            return Err(LotError::Invalid("Un usage unique n'a pas de pièce"));
        }
        if !matches!(draft.quantity, -1 | 1) {
            return Err(LotError::Invalid(
                "Une pièce se reçoit ou se sort à l'unité",
            ));
        }
        let belongs: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM units WHERE id = ? AND lot_id = ? LIMIT 1")
                .bind(unit_id)
                .bind(&draft.lot_id)
                .fetch_optional(&mut **tx)
                .await?;
        if belongs.is_none() {
            return Err(LotError::Invalid("La pièce est introuvable"));
        }
        if draft.session_id.is_some() {
            return Err(LotError::Invalid(
                "Lier une pièce à une séance ne change pas le stock",
            ));
        }
    } else if !single_use {
        return Err(LotError::Invalid(
            "Le stock d'un usage multiple se gère pièce par pièce",
        ));
    }

    if draft.movement_type == MovementType::Consumption {
        if single_use && draft.session_id.is_none() {
            return Err(LotError::Invalid(
                "La consommation d'un usage unique passe par une séance",
            ));
        }
        if !single_use && draft.session_id.is_some() {
            return Err(LotError::Invalid(
                "Lier une pièce à une séance ne change pas le stock",
            ));
        }
    } else if draft.session_id.is_some() && draft.movement_type != MovementType::Adjustment {
        return Err(LotError::Invalid(
            "Seule une consommation d'usage unique est liée à une séance",
        ));
    }

    let sql = format!(
        "INSERT INTO stock_movements
            (id, lot_id, unit_id, session_id, type, quantity, reason, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, {NOW})"
    );
    sqlx::query(&sql)
        .bind(&draft.lot_id)
        .bind(&draft.unit_id)
        .bind(&draft.session_id)
        .bind(draft.movement_type.as_str())
        .bind(draft.quantity)
        .bind(&draft.reason)
        .execute(&mut **tx)
        .await?;

    if let Some(unit_id) = &draft.unit_id {
        let sum: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE unit_id = ?",
        )
        .bind(unit_id)
        .fetch_one(&mut **tx)
        .await?;
        if sum < 0 {
            return Err(LotError::Invalid("Cette pièce est déjà sortie du stock"));
        }
        if sum > 1 {
            return Err(LotError::Invalid("Cette pièce est déjà en stock"));
        }
    } else {
        let sum: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE lot_id = ?",
        )
        .bind(&draft.lot_id)
        .fetch_one(&mut **tx)
        .await?;
        if sum < 0 {
            return Err(LotError::Invalid("Le stock deviendrait négatif"));
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordMovementInput {
    pub lot_id: String,
    pub movement_type: String,
    pub quantity: i64,
    pub reason: Option<String>,
}

pub async fn list_movements(
    pool: &sqlx::SqlitePool,
    lot_id: &str,
) -> Result<Vec<StockMovement>, LotError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM lots WHERE id = ? LIMIT 1")
        .bind(lot_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(LotError::NotFound);
    }
    let items = sqlx::query_as::<_, StockMovement>(
        "SELECT id, lot_id, unit_id, session_id, type, quantity, reason, created_at
         FROM stock_movements
         WHERE lot_id = ?
         ORDER BY created_at DESC, id DESC",
    )
    .bind(lot_id)
    .fetch_all(pool)
    .await?;
    Ok(items)
}

/// Corrige une saisie en ajoutant le mouvement inverse. L'original reste dans l'historique.
pub async fn undo_movement(pool: &sqlx::SqlitePool, movement_id: &str) -> Result<String, LotError> {
    let movement = sqlx::query_as::<_, StockMovement>(
        "SELECT id, lot_id, unit_id, session_id, type, quantity, reason, created_at
         FROM stock_movements
         WHERE id = ?",
    )
    .bind(movement_id)
    .fetch_optional(pool)
    .await?
    .ok_or(LotError::NotFound)?;

    let mut tx = pool.begin().await?;
    if let Some(session_id) = &movement.session_id {
        // Un lien annulé a déjà rendu son stock : défaire ses mouvements
        // ferait réapparaître une consommation sur un lien annulé.
        let voided: Option<i64> = sqlx::query_scalar(
            "SELECT 1
             FROM session_usages su
             INNER JOIN session_usage_voids v ON v.session_usage_id = su.id
             WHERE su.session_id = ? AND su.lot_id = ?
             LIMIT 1",
        )
        .bind(session_id)
        .bind(&movement.lot_id)
        .fetch_optional(&mut *tx)
        .await?;
        if voided.is_some() {
            return Err(LotError::Invalid(
                "Ce mouvement appartient à un lien de séance annulé : il ne peut plus être défait",
            ));
        }
    }
    let archived: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM client_archive_movements
         WHERE movement_id = ?1 OR restore_movement_id = ?1 LIMIT 1",
    )
    .bind(&movement.id)
    .fetch_optional(&mut *tx)
    .await?;
    if archived.is_some() {
        return Err(LotError::Invalid(
            "Ce mouvement vient de l'archivage d'un client : désarchivez le client pour le défaire",
        ));
    }
    apply_movement(
        &mut tx,
        MovementDraft {
            lot_id: movement.lot_id.clone(),
            unit_id: movement.unit_id,
            session_id: movement.session_id,
            movement_type: MovementType::Adjustment,
            quantity: -movement.quantity,
            reason: Some("Annulation d'une erreur de saisie".into()),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(movement.lot_id)
}

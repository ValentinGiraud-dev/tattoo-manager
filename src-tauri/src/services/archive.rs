//! Messages communs et dérogation de stock pour l'archivage d'un client.
//!
//! Un lot archivé refuse les mouvements. L'archivage d'un client remet pourtant
//! la consommation des usages uniques, y compris sur un lot déjà archivé : le
//! drapeau `lot_movement` (table `schema_flags`) n'existe que le temps de cette
//! transaction.

use sqlx::{Sqlite, SqlitePool, Transaction};

use super::error::LotError;

pub const CLIENT_LOCKED: &str = "Ce client est archivé : désarchivez-le pour le modifier";
pub const SESSION_LOCKED: &str = "Cette séance est archivée : désarchivez-la pour la modifier";
pub const PROJECT_LOCKED: &str = "Ce projet est archivé : désarchivez-le pour le modifier";
pub const LOT_LOCKED: &str = "Ce lot est archivé : désarchivez-le pour le modifier";
pub const SHEET_LOCKED: &str = "Cette fiche est archivée : désarchivez-la pour la modifier";

const LOT_FLAG: &str = "lot_movement";

pub async fn begin_lot_movement(tx: &mut Transaction<'_, Sqlite>) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO schema_flags (name) VALUES (?)")
        .bind(LOT_FLAG)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn end_lot_movement(tx: &mut Transaction<'_, Sqlite>) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM schema_flags WHERE name = ?")
        .bind(LOT_FLAG)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Refuse d'écrire sur une séance archivée ou sur la séance d'un client archivé.
pub async fn ensure_session_writable(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
) -> Result<(), LotError> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT s.archived_at, c.archived_at
         FROM sessions s
         INNER JOIN clients c ON c.id = s.client_id
         WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_optional(&mut **tx)
    .await?;
    match row {
        None => Err(LotError::Invalid("La séance est introuvable")),
        Some((Some(_), _)) => Err(LotError::Invalid(SESSION_LOCKED)),
        Some((_, Some(_))) => Err(LotError::Invalid(CLIENT_LOCKED)),
        Some((None, None)) => Ok(()),
    }
}

/// Même contrôle, hors transaction.
pub async fn ensure_session_open(pool: &SqlitePool, session_id: &str) -> Result<(), LotError> {
    let mut tx = pool.begin().await?;
    let result = ensure_session_writable(&mut tx, session_id).await;
    tx.commit().await?;
    result
}

pub async fn ensure_unit_lot_open(pool: &SqlitePool, unit_id: &str) -> Result<(), LotError> {
    let archived: Option<Option<String>> = sqlx::query_scalar(
        "SELECT l.archived_at FROM units u JOIN lots l ON l.id = u.lot_id WHERE u.id = ?",
    )
    .bind(unit_id)
    .fetch_optional(pool)
    .await?;
    match archived {
        None => Err(LotError::NotFound),
        Some(Some(_)) => Err(LotError::Invalid(LOT_LOCKED)),
        Some(None) => Ok(()),
    }
}

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::sql::{clean, is_iso_date, like_pattern, NOW};

use crate::models::SessionStatus;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub client_id: String,
    /// Projet (pièce en plusieurs séances) du même client.
    #[serde(default)]
    pub project_id: Option<String>,
    pub date: String,
    /// Heure locale de début « HH:MM ».
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub duration_minutes: Option<i64>,
    pub status: SessionStatus,
    /// Prix convenu, en centimes.
    #[serde(default)]
    pub price_cents: Option<i64>,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
}

/// Durée d'une séance : de 15 min à 12 h.
pub const MIN_DURATION_MINUTES: i64 = 15;
pub const MAX_DURATION_MINUTES: i64 = 720;
/// Prix maximal accepté (100 000 €), en centimes : protège des fautes de frappe.
pub const MAX_PRICE_CENTS: i64 = 10_000_000;

/// Minutes depuis minuit pour une heure « HH:MM » valide (00:00 à 23:59).
pub fn minutes_of(time: &str) -> Option<i64> {
    let bytes = time.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 2 || b.is_ascii_digit())
    {
        return None;
    }
    let hours: i64 = time[0..2].parse().ok()?;
    let minutes: i64 = time[3..5].parse().ok()?;
    (hours < 24 && minutes < 60).then_some(hours * 60 + minutes)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: String,
    pub client_id: String,
    pub project_id: Option<String>,
    pub project_title: Option<String>,
    pub date: String,
    pub start_time: Option<String>,
    pub duration_minutes: Option<i64>,
    pub status: SessionStatus,
    pub price_cents: Option<i64>,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub client_first_name: String,
    pub client_last_name: String,
    /// Nombre de produits liés. Au-delà de zéro, le client ne change plus.
    pub usage_count: i64,
    /// Acomptes ou paiements rattachés : le client ne change plus non plus.
    pub money_count: i64,
    /// Nombre d'absences du client (toutes séances confondues).
    pub client_no_show_count: i64,
}

#[derive(Debug)]
pub enum SessionError {
    Invalid(&'static str),
    NotFound,
    /// Erreur SQLite, déjà journalisée. Le détail ne remonte pas à l'écran.
    Database,
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Séance introuvable"),
            Self::Database => write!(f, "{}", super::sql::DATABASE_MESSAGE),
        }
    }
}

impl From<sqlx::Error> for SessionError {
    fn from(error: sqlx::Error) -> Self {
        super::sql::log_database_error(&error);
        Self::Database
    }
}

async fn ensure_client_exists(pool: &SqlitePool, client_id: &str) -> Result<(), SessionError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM clients WHERE id = ? LIMIT 1")
        .bind(client_id)
        .fetch_optional(pool)
        .await?;
    if exists.is_none() {
        return Err(SessionError::Invalid(
            "Le client sélectionné est introuvable",
        ));
    }
    Ok(())
}

async fn normalize(pool: &SqlitePool, input: SessionInput) -> Result<SessionInput, SessionError> {
    let client_id = input.client_id.trim().to_string();
    if client_id.is_empty() {
        return Err(SessionError::Invalid("Le client est obligatoire"));
    }
    ensure_client_exists(pool, &client_id).await?;

    let date = input.date.trim().to_string();
    if date.is_empty() {
        return Err(SessionError::Invalid("La date est obligatoire"));
    }
    if !is_iso_date(&date) {
        return Err(SessionError::Invalid(
            "La date doit être au format AAAA-MM-JJ",
        ));
    }

    let start_time = clean(input.start_time);
    if let Some(time) = &start_time {
        if minutes_of(time).is_none() {
            return Err(SessionError::Invalid("L'heure doit être au format HH:MM"));
        }
    }
    if let Some(duration) = input.duration_minutes {
        if !(MIN_DURATION_MINUTES..=MAX_DURATION_MINUTES).contains(&duration) {
            return Err(SessionError::Invalid(
                "La durée doit être comprise entre 15 minutes et 12 heures",
            ));
        }
    }
    if input.duration_minutes.is_some() && start_time.is_none() {
        return Err(SessionError::Invalid(
            "Indique l'heure de début pour une durée",
        ));
    }
    if let Some(price) = input.price_cents {
        if !(0..=MAX_PRICE_CENTS).contains(&price) {
            return Err(SessionError::Invalid("Le prix n'est pas valide"));
        }
    }

    let project_id = clean(input.project_id);
    if let Some(project_id) = &project_id {
        let owner: Option<String> =
            sqlx::query_scalar("SELECT client_id FROM projects WHERE id = ?")
                .bind(project_id)
                .fetch_optional(pool)
                .await?;
        match owner {
            None => return Err(SessionError::Invalid("Le projet est introuvable")),
            Some(owner) if owner != client_id => {
                return Err(SessionError::Invalid(
                    "Le projet appartient à un autre client",
                ));
            }
            Some(_) => {}
        }
    }

    Ok(SessionInput {
        client_id,
        project_id,
        date,
        start_time,
        duration_minutes: input.duration_minutes,
        status: input.status,
        price_cents: input.price_cents,
        body_area: clean(input.body_area),
        description: clean(input.description),
        notes: clean(input.notes),
    })
}

/// Message affiché quand on tente de changer le client d'une séance qui a des produits liés.
pub(crate) const SESSION_CLIENT_LOCKED: &str = "Cette séance a des produits liés : elle ne peut plus changer de client. Si la séance a été créée pour le mauvais client, crée une nouvelle séance pour le bon client.";
pub(crate) const SESSION_CLIENT_LOCKED_MONEY: &str = "Cette séance a des acomptes ou des paiements : elle ne peut plus changer de client. Si la séance a été créée pour le mauvais client, crée une nouvelle séance pour le bon client.";

const LIST_SELECT: &str = "SELECT
    s.id,
    s.client_id,
    s.project_id,
    p.title AS project_title,
    s.date,
    s.start_time,
    s.duration_minutes,
    s.status,
    s.price_cents,
    s.body_area,
    s.description,
    s.notes,
    s.created_at,
    s.updated_at,
    c.first_name AS client_first_name,
    c.last_name AS client_last_name,
    (SELECT COUNT(*) FROM session_usages su WHERE su.session_id = s.id) AS usage_count,
    (SELECT COUNT(*) FROM payments pa WHERE pa.session_id = s.id)
        + (SELECT COUNT(*) FROM deposits d WHERE d.session_id = s.id)
        + (SELECT COUNT(*) FROM deposit_outcomes o WHERE o.session_id = s.id) AS money_count,
    (SELECT COUNT(*) FROM sessions ns
        WHERE ns.client_id = s.client_id AND ns.status = 'NO_SHOW') AS client_no_show_count
 FROM sessions s
 INNER JOIN clients c ON c.id = s.client_id
 LEFT JOIN projects p ON p.id = s.project_id";

const ORDER: &str =
    "ORDER BY s.date DESC, s.start_time IS NULL, s.start_time DESC, s.created_at DESC";

pub async fn list_sessions(
    pool: &SqlitePool,
    search: Option<String>,
) -> Result<Vec<SessionListItem>, SessionError> {
    let pattern = like_pattern(search);

    let sql = format!(
        "{LIST_SELECT}
         WHERE ?1 IS NULL
            OR c.first_name LIKE ?1 ESCAPE '\\'
            OR c.last_name LIKE ?1 ESCAPE '\\'
            OR c.first_name || ' ' || c.last_name LIKE ?1 ESCAPE '\\'
            OR c.last_name || ' ' || c.first_name LIKE ?1 ESCAPE '\\'
            OR s.body_area LIKE ?1 ESCAPE '\\'
            OR s.description LIKE ?1 ESCAPE '\\'
            OR s.notes LIKE ?1 ESCAPE '\\'
            OR p.title LIKE ?1 ESCAPE '\\'
         {ORDER}"
    );

    let sessions = sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(pattern)
        .fetch_all(pool)
        .await?;
    Ok(sessions)
}

/// Séances entre deux dates incluses (planning), dans l'ordre chronologique.
pub async fn list_sessions_between(
    pool: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<Vec<SessionListItem>, SessionError> {
    if !is_iso_date(from) || !is_iso_date(to) || from > to {
        return Err(SessionError::Invalid("Période invalide"));
    }
    let sql = format!(
        "{LIST_SELECT}
         WHERE s.date BETWEEN ? AND ?
         ORDER BY s.date, s.start_time IS NULL, s.start_time, s.created_at"
    );
    let sessions = sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(from)
        .bind(to)
        .fetch_all(pool)
        .await?;
    Ok(sessions)
}

pub async fn get_session(pool: &SqlitePool, id: &str) -> Result<SessionListItem, SessionError> {
    let sql = format!("{LIST_SELECT} WHERE s.id = ?");
    sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(SessionError::NotFound)
}

/// Séances prévues ou faites qui chevauchent un créneau, le même jour.
/// Sert d'avertissement : un chevauchement n'est pas interdit.
pub async fn find_overlaps(
    pool: &SqlitePool,
    date: &str,
    start_time: &str,
    duration_minutes: i64,
    exclude_id: Option<&str>,
) -> Result<Vec<SessionListItem>, SessionError> {
    let Some(start) = minutes_of(start_time) else {
        return Err(SessionError::Invalid("L'heure doit être au format HH:MM"));
    };
    let end = start + duration_minutes.max(MIN_DURATION_MINUTES);
    let sql = format!(
        "{LIST_SELECT}
         WHERE s.date = ?
           AND s.start_time IS NOT NULL
           AND s.status IN ('PLANNED', 'COMPLETED')
           AND (? IS NULL OR s.id != ?)
         ORDER BY s.start_time"
    );
    let same_day = sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(date)
        .bind(exclude_id)
        .bind(exclude_id)
        .fetch_all(pool)
        .await?;
    Ok(same_day
        .into_iter()
        .filter(|other| {
            let Some(other_start) = other.start_time.as_deref().and_then(minutes_of) else {
                return false;
            };
            // Sans durée connue, on compte une heure.
            let other_end = other_start + other.duration_minutes.unwrap_or(60);
            other_start < end && start < other_end
        })
        .collect())
}

pub async fn create_session(
    pool: &SqlitePool,
    input: SessionInput,
) -> Result<SessionListItem, SessionError> {
    let input = normalize(pool, input).await?;
    let sql = format!(
        "INSERT INTO sessions
            (id, client_id, project_id, date, start_time, duration_minutes, status, price_cents,
             body_area, description, notes, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
         RETURNING id"
    );
    let id: String = sqlx::query_scalar(&sql)
        .bind(&input.client_id)
        .bind(&input.project_id)
        .bind(&input.date)
        .bind(&input.start_time)
        .bind(input.duration_minutes)
        .bind(input.status)
        .bind(input.price_cents)
        .bind(&input.body_area)
        .bind(&input.description)
        .bind(&input.notes)
        .fetch_one(pool)
        .await?;
    get_session(pool, &id).await
}

pub async fn update_session(
    pool: &SqlitePool,
    id: &str,
    input: SessionInput,
) -> Result<SessionListItem, SessionError> {
    let input = normalize(pool, input).await?;
    let current = get_session(pool, id).await?;

    // Les produits, acomptes et paiements appartiennent à l'historique de ce client :
    // la séance ne peut plus être déplacée vers un autre client.
    if current.client_id != input.client_id {
        if current.usage_count > 0 {
            return Err(SessionError::Invalid(SESSION_CLIENT_LOCKED));
        }
        if current.money_count > 0 {
            return Err(SessionError::Invalid(SESSION_CLIENT_LOCKED_MONEY));
        }
    }

    let sql = format!(
        "UPDATE sessions
         SET client_id = ?, project_id = ?, date = ?, start_time = ?, duration_minutes = ?,
             status = ?, price_cents = ?, body_area = ?, description = ?, notes = ?,
             updated_at = {NOW}
         WHERE id = ?"
    );
    sqlx::query(&sql)
        .bind(&input.client_id)
        .bind(&input.project_id)
        .bind(&input.date)
        .bind(&input.start_time)
        .bind(input.duration_minutes)
        .bind(input.status)
        .bind(input.price_cents)
        .bind(&input.body_area)
        .bind(&input.description)
        .bind(&input.notes)
        .bind(id)
        .execute(pool)
        .await?;
    get_session(pool, id).await
}

/// Séances d'un client, de la plus récente à la plus ancienne.
pub async fn list_client_sessions(
    pool: &SqlitePool,
    client_id: &str,
) -> Result<Vec<SessionListItem>, SessionError> {
    let sql = format!("{LIST_SELECT} WHERE s.client_id = ? {ORDER}");
    let sessions = sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(client_id)
        .fetch_all(pool)
        .await?;
    Ok(sessions)
}

/// Séances d'un projet, dans l'ordre chronologique.
pub async fn list_project_sessions(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<SessionListItem>, SessionError> {
    let sql = format!(
        "{LIST_SELECT} WHERE s.project_id = ?
         ORDER BY s.date, s.start_time IS NULL, s.start_time, s.created_at"
    );
    let sessions = sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(project_id)
        .fetch_all(pool)
        .await?;
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::minutes_of;

    #[test]
    fn times_are_parsed_strictly() {
        assert_eq!(minutes_of("00:00"), Some(0));
        assert_eq!(minutes_of("14:30"), Some(870));
        assert_eq!(minutes_of("23:59"), Some(1439));
        for bad in ["24:00", "9:30", "12:60", "12h30", "ab:cd", "+1:00"] {
            assert_eq!(minutes_of(bad), None, "{bad}");
        }
    }
}

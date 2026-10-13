use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::models::SessionStatus;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub client_id: String,
    pub date: String,
    pub status: SessionStatus,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: String,
    pub client_id: String,
    pub date: String,
    pub status: SessionStatus,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub client_first_name: String,
    pub client_last_name: String,
}

#[derive(Debug)]
pub enum SessionError {
    Invalid(&'static str),
    NotFound,
    Database(sqlx::Error),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Séance introuvable"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl From<sqlx::Error> for SessionError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..].iter().all(u8::is_ascii_digit)
}

async fn ensure_client_exists(pool: &SqlitePool, client_id: &str) -> Result<(), SessionError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM clients WHERE id = ? LIMIT 1")
            .bind(client_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(SessionError::Invalid("Le client sélectionné est introuvable"));
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

    Ok(SessionInput {
        client_id,
        date,
        status: input.status,
        body_area: clean(input.body_area),
        description: clean(input.description),
        notes: clean(input.notes),
    })
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%S', 'now')";

const LIST_SELECT: &str = "SELECT
    s.id,
    s.client_id,
    s.date,
    s.status,
    s.body_area,
    s.description,
    s.notes,
    s.created_at,
    s.updated_at,
    c.first_name AS client_first_name,
    c.last_name AS client_last_name
 FROM sessions s
 INNER JOIN clients c ON c.id = s.client_id";

pub async fn list_sessions(
    pool: &SqlitePool,
    search: Option<String>,
) -> Result<Vec<SessionListItem>, SessionError> {
    let pattern = clean(search).map(|text| {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    });

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
         ORDER BY s.date DESC, s.created_at DESC"
    );

    let sessions = sqlx::query_as::<_, SessionListItem>(&sql)
        .bind(pattern)
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

pub async fn create_session(
    pool: &SqlitePool,
    input: SessionInput,
) -> Result<SessionListItem, SessionError> {
    let input = normalize(pool, input).await?;
    let sql = format!(
        "INSERT INTO sessions
            (id, client_id, date, status, body_area, description, notes, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
         RETURNING id"
    );
    let id: String = sqlx::query_scalar(&sql)
        .bind(&input.client_id)
        .bind(&input.date)
        .bind(input.status)
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
    let sql = format!(
        "UPDATE sessions
         SET client_id = ?, date = ?, status = ?, body_area = ?, description = ?, notes = ?,
             updated_at = {NOW}
         WHERE id = ?
         RETURNING id"
    );
    let updated_id: Option<String> = sqlx::query_scalar(&sql)
        .bind(&input.client_id)
        .bind(&input.date)
        .bind(input.status)
        .bind(&input.body_area)
        .bind(&input.description)
        .bind(&input.notes)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    let updated_id = updated_id.ok_or(SessionError::NotFound)?;
    get_session(pool, &updated_id).await
}

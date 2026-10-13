use serde::Deserialize;
use sqlx::SqlitePool;

use crate::models::Client;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInput {
    pub first_name: String,
    pub last_name: String,
    pub birth_date: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug)]
pub enum ClientError {
    Invalid(&'static str),
    NotFound,
    Database(sqlx::Error),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Client introuvable"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl From<sqlx::Error> for ClientError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize(input: ClientInput) -> Result<ClientInput, ClientError> {
    let first_name = input.first_name.trim().to_string();
    let last_name = input.last_name.trim().to_string();
    if first_name.is_empty() {
        return Err(ClientError::Invalid("Le prénom est obligatoire"));
    }
    if last_name.is_empty() {
        return Err(ClientError::Invalid("Le nom est obligatoire"));
    }
    Ok(ClientInput {
        first_name,
        last_name,
        birth_date: clean(input.birth_date),
        email: clean(input.email),
        phone: clean(input.phone),
        notes: clean(input.notes),
    })
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%S', 'now')";

/// Liste les clients ; `search` filtre sur nom, prénom, email et téléphone.
pub async fn list_clients(
    pool: &SqlitePool,
    search: Option<String>,
) -> Result<Vec<Client>, ClientError> {
    let pattern = clean(search).map(|text| {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    });

    let clients = sqlx::query_as::<_, Client>(
        "SELECT * FROM clients
         WHERE ?1 IS NULL
            OR first_name LIKE ?1 ESCAPE '\\'
            OR last_name LIKE ?1 ESCAPE '\\'
            OR first_name || ' ' || last_name LIKE ?1 ESCAPE '\\'
            OR last_name || ' ' || first_name LIKE ?1 ESCAPE '\\'
            OR email LIKE ?1 ESCAPE '\\'
            OR phone LIKE ?1 ESCAPE '\\'
         ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE",
    )
    .bind(pattern)
    .fetch_all(pool)
    .await?;
    Ok(clients)
}

pub async fn get_client(pool: &SqlitePool, id: &str) -> Result<Client, ClientError> {
    sqlx::query_as::<_, Client>("SELECT * FROM clients WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(ClientError::NotFound)
}

pub async fn create_client(pool: &SqlitePool, input: ClientInput) -> Result<Client, ClientError> {
    let input = normalize(input)?;
    let sql = format!(
        "INSERT INTO clients
            (id, first_name, last_name, birth_date, email, phone, notes, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
         RETURNING *"
    );
    let client = sqlx::query_as::<_, Client>(&sql)
        .bind(input.first_name)
        .bind(input.last_name)
        .bind(input.birth_date)
        .bind(input.email)
        .bind(input.phone)
        .bind(input.notes)
        .fetch_one(pool)
        .await?;
    Ok(client)
}

pub async fn update_client(
    pool: &SqlitePool,
    id: &str,
    input: ClientInput,
) -> Result<Client, ClientError> {
    let input = normalize(input)?;
    let sql = format!(
        "UPDATE clients
         SET first_name = ?, last_name = ?, birth_date = ?, email = ?, phone = ?, notes = ?,
             updated_at = {NOW}
         WHERE id = ?
         RETURNING *"
    );
    sqlx::query_as::<_, Client>(&sql)
        .bind(input.first_name)
        .bind(input.last_name)
        .bind(input.birth_date)
        .bind(input.email)
        .bind(input.phone)
        .bind(input.notes)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(ClientError::NotFound)
}

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::models::Product;

#[derive(Debug)]
pub enum SessionProductError {
    Invalid(&'static str),
    NotFound,
    AlreadyLinked,
    Database(sqlx::Error),
}

impl std::fmt::Display for SessionProductError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Lien séance–produit introuvable"),
            Self::AlreadyLinked => write!(f, "Ce produit est déjà lié à cette séance"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl From<sqlx::Error> for SessionProductError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionProductItem {
    pub session_id: String,
    pub product_id: String,
    pub created_at: String,
    pub name: String,
    pub lot_number: String,
    pub expiration_date: String,
    pub single_use: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProductSessionItem {
    pub session_id: String,
    pub product_id: String,
    pub created_at: String,
    pub date: String,
    pub status: String,
    pub body_area: Option<String>,
    pub client_first_name: String,
    pub client_last_name: String,
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%S', 'now')";

async fn ensure_session(pool: &SqlitePool, session_id: &str) -> Result<(), SessionProductError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM sessions WHERE id = ? LIMIT 1")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(SessionProductError::Invalid("La séance est introuvable"));
    }
    Ok(())
}

async fn ensure_product(pool: &SqlitePool, product_id: &str) -> Result<(), SessionProductError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM products WHERE id = ? LIMIT 1")
            .bind(product_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(SessionProductError::Invalid("Le produit est introuvable"));
    }
    Ok(())
}

/// Produits liés à une séance (traçabilité).
pub async fn list_session_products(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<SessionProductItem>, SessionProductError> {
    ensure_session(pool, session_id).await?;
    let items = sqlx::query_as::<_, SessionProductItem>(
        "SELECT
            sp.session_id,
            sp.product_id,
            sp.created_at,
            p.name,
            p.lot_number,
            p.expiration_date,
            p.single_use
         FROM session_products sp
         INNER JOIN products p ON p.id = sp.product_id
         WHERE sp.session_id = ?
         ORDER BY sp.created_at ASC, p.name COLLATE NOCASE",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(items)
}

/// Séances où un produit a été utilisé.
pub async fn list_product_sessions(
    pool: &SqlitePool,
    product_id: &str,
) -> Result<Vec<ProductSessionItem>, SessionProductError> {
    ensure_product(pool, product_id).await?;
    let items = sqlx::query_as::<_, ProductSessionItem>(
        "SELECT
            sp.session_id,
            sp.product_id,
            sp.created_at,
            s.date,
            s.status,
            s.body_area,
            c.first_name AS client_first_name,
            c.last_name AS client_last_name
         FROM session_products sp
         INNER JOIN sessions s ON s.id = sp.session_id
         INNER JOIN clients c ON c.id = s.client_id
         WHERE sp.product_id = ?
         ORDER BY s.date DESC, sp.created_at DESC",
    )
    .bind(product_id)
    .fetch_all(pool)
    .await?;
    Ok(items)
}

/// Lie un produit à une séance. Les liens ne se suppriment pas (règle V1).
pub async fn link_session_product(
    pool: &SqlitePool,
    session_id: &str,
    product_id: &str,
) -> Result<SessionProductItem, SessionProductError> {
    let session_id = session_id.trim();
    let product_id = product_id.trim();
    if session_id.is_empty() {
        return Err(SessionProductError::Invalid("La séance est obligatoire"));
    }
    if product_id.is_empty() {
        return Err(SessionProductError::Invalid("Le produit est obligatoire"));
    }

    ensure_session(pool, session_id).await?;
    ensure_product(pool, product_id).await?;

    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM session_products WHERE session_id = ? AND product_id = ? LIMIT 1",
    )
    .bind(session_id)
    .bind(product_id)
    .fetch_optional(pool)
    .await?;
    if existing.is_some() {
        return Err(SessionProductError::AlreadyLinked);
    }

    let sql = format!(
        "INSERT INTO session_products (session_id, product_id, created_at)
         VALUES (?, ?, {NOW})"
    );
    sqlx::query(&sql)
        .bind(session_id)
        .bind(product_id)
        .execute(pool)
        .await?;

    let items = list_session_products(pool, session_id).await?;
    items
        .into_iter()
        .find(|item| item.product_id == product_id)
        .ok_or(SessionProductError::NotFound)
}

/// Produits pas encore liés à la séance (pour le sélecteur UI).
pub async fn list_linkable_products(
    pool: &SqlitePool,
    session_id: &str,
    search: Option<String>,
) -> Result<Vec<Product>, SessionProductError> {
    ensure_session(pool, session_id).await?;
    let pattern = search
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .map(|text| {
            let escaped = text
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            format!("%{escaped}%")
        });

    let products = sqlx::query_as::<_, Product>(
        "SELECT p.* FROM products p
         WHERE p.id NOT IN (
             SELECT product_id FROM session_products WHERE session_id = ?1
         )
         AND (
             ?2 IS NULL
             OR p.name LIKE ?2 ESCAPE '\\'
             OR p.lot_number LIKE ?2 ESCAPE '\\'
         )
         ORDER BY p.name COLLATE NOCASE, p.lot_number COLLATE NOCASE",
    )
    .bind(session_id)
    .bind(pattern)
    .fetch_all(pool)
    .await?;
    Ok(products)
}

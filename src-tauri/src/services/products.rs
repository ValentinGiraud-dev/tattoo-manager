use serde::Deserialize;
use sqlx::SqlitePool;

use crate::models::Product;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductInput {
    pub name: String,
    pub lot_number: String,
    pub creation_date: Option<String>,
    pub opened_at: Option<String>,
    pub expiration_date: String,
    pub after_opening_months: Option<i64>,
    pub single_use: bool,
    pub product_url: Option<String>,
}

#[derive(Debug)]
pub enum ProductError {
    Invalid(&'static str),
    NotFound,
    Database(sqlx::Error),
}

impl std::fmt::Display for ProductError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) => write!(f, "{message}"),
            Self::NotFound => write!(f, "Produit introuvable"),
            Self::Database(error) => write!(f, "{error}"),
        }
    }
}

impl From<sqlx::Error> for ProductError {
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

fn normalize(input: ProductInput) -> Result<ProductInput, ProductError> {
    let name = input.name.trim().to_string();
    let lot_number = input.lot_number.trim().to_string();
    let expiration_date = input.expiration_date.trim().to_string();

    if name.is_empty() {
        return Err(ProductError::Invalid("Le nom est obligatoire"));
    }
    if lot_number.is_empty() {
        return Err(ProductError::Invalid("Le numéro de lot est obligatoire"));
    }
    if expiration_date.is_empty() {
        return Err(ProductError::Invalid(
            "La date d'expiration est obligatoire",
        ));
    }
    if !is_iso_date(&expiration_date) {
        return Err(ProductError::Invalid(
            "La date d'expiration doit être au format AAAA-MM-JJ",
        ));
    }

    let creation_date = clean(input.creation_date);
    if let Some(ref date) = creation_date {
        if !is_iso_date(date) {
            return Err(ProductError::Invalid(
                "La date de création doit être au format AAAA-MM-JJ",
            ));
        }
    }

    let opened_at = clean(input.opened_at);
    if let Some(ref date) = opened_at {
        if !is_iso_date(date) {
            return Err(ProductError::Invalid(
                "La date d'ouverture doit être au format AAAA-MM-JJ",
            ));
        }
    }

    if let Some(months) = input.after_opening_months {
        if months <= 0 {
            return Err(ProductError::Invalid(
                "La durée après ouverture doit être un nombre de mois positif",
            ));
        }
    }

    Ok(ProductInput {
        name,
        lot_number,
        creation_date,
        opened_at,
        expiration_date,
        after_opening_months: input.after_opening_months,
        single_use: input.single_use,
        product_url: clean(input.product_url),
    })
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%S', 'now')";

pub async fn list_products(
    pool: &SqlitePool,
    search: Option<String>,
) -> Result<Vec<Product>, ProductError> {
    let pattern = clean(search).map(|text| {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        format!("%{escaped}%")
    });

    let products = sqlx::query_as::<_, Product>(
        "SELECT * FROM products
         WHERE ?1 IS NULL
            OR name LIKE ?1 ESCAPE '\\'
            OR lot_number LIKE ?1 ESCAPE '\\'
         ORDER BY name COLLATE NOCASE, lot_number COLLATE NOCASE",
    )
    .bind(pattern)
    .fetch_all(pool)
    .await?;
    Ok(products)
}

pub async fn get_product(pool: &SqlitePool, id: &str) -> Result<Product, ProductError> {
    sqlx::query_as::<_, Product>("SELECT * FROM products WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(ProductError::NotFound)
}

pub async fn create_product(
    pool: &SqlitePool,
    input: ProductInput,
) -> Result<Product, ProductError> {
    let input = normalize(input)?;
    let sql = format!(
        "INSERT INTO products
            (id, name, lot_number, creation_date, opened_at, expiration_date,
             after_opening_months, single_use, product_url, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
         RETURNING *"
    );
    let product = sqlx::query_as::<_, Product>(&sql)
        .bind(input.name)
        .bind(input.lot_number)
        .bind(input.creation_date)
        .bind(input.opened_at)
        .bind(input.expiration_date)
        .bind(input.after_opening_months)
        .bind(if input.single_use { 1 } else { 0 })
        .bind(input.product_url)
        .fetch_one(pool)
        .await?;
    Ok(product)
}

pub async fn update_product(
    pool: &SqlitePool,
    id: &str,
    input: ProductInput,
) -> Result<Product, ProductError> {
    let input = normalize(input)?;
    let sql = format!(
        "UPDATE products
         SET name = ?, lot_number = ?, creation_date = ?, opened_at = ?,
             expiration_date = ?, after_opening_months = ?, single_use = ?,
             product_url = ?, updated_at = {NOW}
         WHERE id = ?
         RETURNING *"
    );
    sqlx::query_as::<_, Product>(&sql)
        .bind(input.name)
        .bind(input.lot_number)
        .bind(input.creation_date)
        .bind(input.opened_at)
        .bind(input.expiration_date)
        .bind(input.after_opening_months)
        .bind(if input.single_use { 1 } else { 0 })
        .bind(input.product_url)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(ProductError::NotFound)
}

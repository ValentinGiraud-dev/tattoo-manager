use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: String,
    pub name: String,
    pub lot_number: String,
    pub creation_date: Option<String>,
    pub opened_at: Option<String>,
    pub expiration_date: String,
    pub after_opening_months: Option<i64>,
    pub single_use: bool,
    pub product_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

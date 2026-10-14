use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Lot {
    pub id: String,
    pub name: String,
    pub lot_number: String,
    pub creation_date: Option<String>,
    pub expiration_date: String,
    pub single_use: bool,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

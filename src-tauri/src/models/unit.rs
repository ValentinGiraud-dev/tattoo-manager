use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub id: String,
    pub lot_id: String,
    pub opened_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

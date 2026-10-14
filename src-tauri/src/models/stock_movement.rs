use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct StockMovement {
    pub id: String,
    pub lot_id: String,
    pub unit_id: Option<String>,
    pub session_id: Option<String>,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub movement_type: String,
    pub quantity: i64,
    pub reason: Option<String>,
    pub created_at: String,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    pub id: String,
    pub session_id: String,
    pub lot_id: Option<String>,
    pub unit_id: Option<String>,
    pub created_at: String,
}

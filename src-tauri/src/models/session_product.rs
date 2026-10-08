use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionProduct {
    pub session_id: String,
    pub product_id: String,
    pub created_at: String,
}

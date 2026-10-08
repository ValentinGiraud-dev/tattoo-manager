use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionStatus {
    Planned,
    Completed,
    Cancelled,
    Rescheduled,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub client_id: String,
    pub date: String,
    pub status: SessionStatus,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

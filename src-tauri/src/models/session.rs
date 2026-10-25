use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionStatus {
    Planned,
    Completed,
    Cancelled,
    Rescheduled,
    /// Client absent sans prévenir.
    NoShow,
}

/// Décision sur les documents d'une séance. Posée une seule fois.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Readiness {
    /// Les documents sont là : la prestation peut se faire. Le statut ne change pas.
    Feasible,
    /// Document manquant, avis médical ou autre. La séance passe en Reportée.
    Postponed,
    /// Le client n'est pas apte. La séance passe en Annulée.
    Impossible,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub client_id: String,
    pub project_id: Option<String>,
    pub title: Option<String>,
    pub date: String,
    pub start_time: Option<String>,
    pub duration_minutes: Option<i64>,
    pub status: SessionStatus,
    pub price_cents: Option<i64>,
    pub body_area: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

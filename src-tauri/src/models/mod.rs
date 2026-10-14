mod client;
mod lot;
mod session;
mod session_usage;
mod stock_movement;
mod unit;

pub use client::Client;
pub use lot::Lot;
pub use session::{Session, SessionStatus};
pub use session_usage::SessionUsage;
pub use stock_movement::StockMovement;
pub use unit::Unit;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_status_matches_the_sql_check() {
        let labels = [
            SessionStatus::Planned,
            SessionStatus::Completed,
            SessionStatus::Cancelled,
            SessionStatus::Rescheduled,
        ]
        .map(|status| serde_json::to_value(status).unwrap());

        assert_eq!(
            labels.map(|value| value.as_str().unwrap().to_string()),
            [
                "PLANNED".to_string(),
                "COMPLETED".to_string(),
                "CANCELLED".to_string(),
                "RESCHEDULED".to_string(),
            ]
        );
    }

    #[test]
    fn lot_links_a_session_to_a_bottle_or_a_single_use_lot() {
        let lot = Lot {
            id: "lot-1".into(),
            name: "Encre noire".into(),
            lot_number: "LOT-123".into(),
            creation_date: None,
            expiration_date: "2030-01-01".into(),
            single_use: false,
            after_opening_months: Some(12),
            product_url: None,
            created_at: "2026-10-08T14:00:00".into(),
            updated_at: "2026-10-08T14:00:00".into(),
        };
        let unit = Unit {
            id: "unit-1".into(),
            lot_id: lot.id.clone(),
            opened_at: None,
            created_at: "2026-10-08T14:00:00".into(),
            updated_at: "2026-10-08T14:00:00".into(),
        };
        let link = SessionUsage {
            id: "usage-1".into(),
            session_id: "session-1".into(),
            lot_id: None,
            unit_id: Some(unit.id.clone()),
            created_at: "2026-10-08T15:00:00".into(),
        };

        assert_eq!(unit.lot_id, lot.id);
        assert_eq!(link.unit_id.as_deref(), Some(unit.id.as_str()));
        assert!(link.lot_id.is_none());
        assert_eq!(lot.after_opening_months, Some(12));
    }
}

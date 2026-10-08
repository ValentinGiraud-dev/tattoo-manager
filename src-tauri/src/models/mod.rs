mod client;
mod product;
mod session;
mod session_product;

pub use client::Client;
pub use product::Product;
pub use session::{Session, SessionStatus};
pub use session_product::SessionProduct;

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
    fn v1_models_link_client_session_and_product() {
        let client = Client {
            id: "client-1".into(),
            first_name: "Léa".into(),
            last_name: "Martin".into(),
            birth_date: None,
            email: None,
            phone: None,
            notes: None,
            created_at: "2026-10-08T14:00:00".into(),
            updated_at: "2026-10-08T14:00:00".into(),
        };
        let session = Session {
            id: "session-1".into(),
            client_id: client.id.clone(),
            date: "2026-10-08T15:00:00".into(),
            status: SessionStatus::Planned,
            body_area: Some("avant-bras".into()),
            description: None,
            notes: None,
            created_at: "2026-10-08T14:00:00".into(),
            updated_at: "2026-10-08T14:00:00".into(),
        };
        let product = Product {
            id: "product-1".into(),
            name: "Encre noire".into(),
            lot_number: "LOT-123".into(),
            creation_date: None,
            opened_at: None,
            expiration_date: "2030-01-01".into(),
            after_opening_months: Some(12),
            single_use: false,
            product_url: None,
            created_at: "2026-10-08T14:00:00".into(),
            updated_at: "2026-10-08T14:00:00".into(),
        };
        let link = SessionProduct {
            session_id: session.id.clone(),
            product_id: product.id.clone(),
            created_at: "2026-10-08T15:00:00".into(),
        };

        assert_eq!(session.client_id, client.id);
        assert_eq!(link.session_id, session.id);
        assert_eq!(link.product_id, product.id);
        assert_eq!(product.after_opening_months, Some(12));
    }
}

//! Péremption : un seul calcul, en Rust, avec la date locale du jour.
//!
//! - Lot ou pièce scellée : la limite est `expiration_date`.
//! - Pièce ouverte : la plus proche entre `expiration_date` et
//!   `opened_at + after_opening_months`. Un mois qui n'existe pas
//!   (31 août + 6 mois) est ramené au dernier jour du mois (28 février) :
//!   on préfère une limite trop tôt qu'une limite trop tard.

use chrono::{Local, Months, NaiveDate};

const FORMAT: &str = "%Y-%m-%d";

/// Date du jour dans le fuseau de l'ordinateur.
pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn parse(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, FORMAT).ok()
}

/// Dernier jour d'utilisation, au format `AAAA-MM-JJ`.
pub fn useful_until(
    expiration_date: &str,
    opened_at: Option<&str>,
    after_opening_months: Option<i64>,
) -> String {
    let Some(expiration) = parse(expiration_date) else {
        return expiration_date.to_string();
    };
    let after_opening = match (opened_at.and_then(parse), after_opening_months) {
        (Some(opened), Some(months)) if months > 0 => u32::try_from(months)
            .ok()
            .and_then(|months| opened.checked_add_months(Months::new(months))),
        _ => None,
    };
    let limit = match after_opening {
        Some(date) if date < expiration => date,
        _ => expiration,
    };
    limit.format(FORMAT).to_string()
}

/// Périmé si la limite est passée. Le jour même de la limite, le produit est encore valable.
pub fn is_expired(useful_until: &str, today: NaiveDate) -> bool {
    parse(useful_until).is_some_and(|limit| limit < today)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        parse(value).unwrap()
    }

    #[test]
    fn sealed_piece_uses_the_printed_expiration() {
        assert_eq!(useful_until("2030-01-01", None, Some(6)), "2030-01-01");
    }

    #[test]
    fn opened_piece_uses_the_closest_limit() {
        // Exemple de database-start.md
        assert_eq!(
            useful_until("2030-01-01", Some("2026-10-08"), Some(6)),
            "2027-04-08"
        );
        assert_eq!(
            useful_until("2026-12-01", Some("2026-10-08"), Some(6)),
            "2026-12-01"
        );
    }

    #[test]
    fn a_missing_day_is_clamped_to_the_end_of_the_month() {
        assert_eq!(
            useful_until("2030-01-01", Some("2026-08-31"), Some(6)),
            "2027-02-28"
        );
    }

    #[test]
    fn opened_without_duration_keeps_the_printed_expiration() {
        assert_eq!(
            useful_until("2030-01-01", Some("2026-10-08"), None),
            "2030-01-01"
        );
    }

    #[test]
    fn the_limit_day_itself_is_not_expired() {
        let today = date("2027-04-08");
        assert!(!is_expired("2027-04-08", today));
        assert!(is_expired("2027-04-07", today));
    }
}

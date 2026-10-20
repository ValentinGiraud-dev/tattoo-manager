//! Exports CSV (comptabilité, séances, registre de traçabilité).
//!
//! Format pensé pour Excel et Numbers en français : séparateur `;`, virgule
//! décimale, UTF-8 avec BOM. Un export n'est fait qu'à la demande, vers un fichier
//! choisi dans le dialogue d'enregistrement (voir `security-privacy.mdc`) : il est en
//! clair, l'écran le signale.

use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::SqlitePool;

use super::billing::{self, PaymentMethod};
use super::categories;
use super::dashboard::parse_period;
use super::error::LotError;
use super::expiry;
use crate::models::SessionStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportKind {
    /// Journal des encaissements : paiements, acomptes, remboursements.
    Payments,
    Sessions,
    /// Produits utilisés par séance (lots, pièces), liens annulés compris.
    Traceability,
}

impl ExportKind {
    /// Code enregistré dans le journal d'audit.
    pub fn code(self) -> &'static str {
        match self {
            Self::Payments => "PAYMENTS",
            Self::Sessions => "SESSIONS",
            Self::Traceability => "TRACEABILITY",
        }
    }
}

pub fn status_label(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Planned => "Planifiée",
        SessionStatus::Completed => "Terminée",
        SessionStatus::Cancelled => "Annulée",
        SessionStatus::Rescheduled => "Reportée",
        SessionStatus::NoShow => "Absent",
    }
}

pub fn method_label(method: PaymentMethod) -> &'static str {
    match method {
        PaymentMethod::Cash => "Espèces",
        PaymentMethod::Card => "Carte",
        PaymentMethod::Transfer => "Virement",
        PaymentMethod::Check => "Chèque",
        PaymentMethod::Other => "Autre",
    }
}

/// Texte libre : guillemets si besoin, et neutralisé s'il pourrait être lu comme
/// une formule par le tableur (`=`, `+`, `-`, `@`…).
pub fn text_cell(value: &str) -> String {
    let mut value = value.replace(['\r', '\n'], " ");
    if value.starts_with(['=', '+', '-', '@', '\t']) {
        value.insert(0, '\'');
    }
    if value.contains([';', '"']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

/// Montant en euros avec virgule décimale : 12345 → « 123,45 », -500 → « -5,00 ».
pub fn euros_cell(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let cents = cents.unsigned_abs();
    format!("{sign}{},{:02}", cents / 100, cents % 100)
}

fn optional(value: Option<&str>) -> String {
    value.map(text_cell).unwrap_or_default()
}

fn line(cells: &[String]) -> String {
    let mut out = cells.join(";");
    out.push_str("\r\n");
    out
}

fn header(names: &[&str]) -> String {
    line(
        &names
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>(),
    )
}

/// Contenu CSV et nombre de lignes de données.
pub struct Csv {
    pub content: String,
    pub rows: usize,
}

impl Csv {
    /// Octets à écrire : BOM UTF-8 pour qu'Excel lise les accents.
    pub fn bytes(&self) -> Vec<u8> {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(self.content.as_bytes());
        bytes
    }
}

pub async fn export(
    pool: &SqlitePool,
    kind: ExportKind,
    from: &str,
    to: &str,
) -> Result<Csv, LotError> {
    let (from, to) = parse_period(from, to)?;
    match kind {
        ExportKind::Payments => payments(pool, from, to).await,
        ExportKind::Sessions => sessions(pool, from, to).await,
        ExportKind::Traceability => traceability(pool, from, to).await,
    }
}

fn day(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

#[derive(sqlx::FromRow)]
struct MoneyRow {
    date: String,
    kind: String,
    first_name: String,
    last_name: String,
    session_date: Option<String>,
    project_title: Option<String>,
    method: PaymentMethod,
    amount_cents: i64,
}

async fn payments(pool: &SqlitePool, from: NaiveDate, to: NaiveDate) -> Result<Csv, LotError> {
    let rows = sqlx::query_as::<_, MoneyRow>(
        "SELECT * FROM (
            SELECT pa.paid_on AS date, 'Paiement' AS kind, c.first_name, c.last_name,
                   s.date AS session_date, p.title AS project_title,
                   pa.method, pa.amount_cents, pa.created_at AS created
            FROM payments pa
            INNER JOIN sessions s ON s.id = pa.session_id
            INNER JOIN clients c ON c.id = s.client_id
            LEFT JOIN projects p ON p.id = s.project_id
            WHERE pa.voided_at IS NULL AND pa.paid_on BETWEEN ?1 AND ?2
            UNION ALL
            SELECT d.received_on, 'Acompte', c.first_name, c.last_name,
                   s.date, p.title, d.method, d.amount_cents, d.created_at
            FROM deposits d
            INNER JOIN clients c ON c.id = d.client_id
            LEFT JOIN sessions s ON s.id = d.session_id
            LEFT JOIN projects p ON p.id = d.project_id
            WHERE d.voided_at IS NULL AND d.received_on BETWEEN ?1 AND ?2
            UNION ALL
            SELECT date(o.created_at, 'localtime'), 'Remboursement d''acompte',
                   c.first_name, c.last_name, s.date, p.title, d.method,
                   -d.amount_cents, o.created_at
            FROM deposit_outcomes o
            INNER JOIN deposits d ON d.id = o.deposit_id
            INNER JOIN clients c ON c.id = d.client_id
            LEFT JOIN sessions s ON s.id = d.session_id
            LEFT JOIN projects p ON p.id = d.project_id
            WHERE o.outcome = 'REFUNDED' AND o.voided_at IS NULL AND d.voided_at IS NULL
              AND date(o.created_at, 'localtime') BETWEEN ?1 AND ?2
         ) ORDER BY date, created",
    )
    .bind(day(from))
    .bind(day(to))
    .fetch_all(pool)
    .await?;

    let mut content = header(&[
        "Date",
        "Type",
        "Nom",
        "Prénom",
        "Séance du",
        "Projet",
        "Mode",
        "Montant (€)",
    ]);
    let mut total = 0;
    for row in &rows {
        total += row.amount_cents;
        content.push_str(&line(&[
            row.date.clone(),
            text_cell(&row.kind),
            text_cell(&row.last_name),
            text_cell(&row.first_name),
            optional(row.session_date.as_deref()),
            optional(row.project_title.as_deref()),
            method_label(row.method).to_string(),
            euros_cell(row.amount_cents),
        ]));
    }
    content.push_str(&line(&[
        String::new(),
        "Total".to_string(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        euros_cell(total),
    ]));
    Ok(Csv {
        content,
        rows: rows.len(),
    })
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    date: String,
    start_time: Option<String>,
    duration_minutes: Option<i64>,
    first_name: String,
    last_name: String,
    project_title: Option<String>,
    body_area: Option<String>,
    status: SessionStatus,
    price_cents: Option<i64>,
    paid_cents: i64,
}

async fn sessions(pool: &SqlitePool, from: NaiveDate, to: NaiveDate) -> Result<Csv, LotError> {
    let sql = format!(
        "SELECT s.date, s.start_time, s.duration_minutes, c.first_name, c.last_name,
                p.title AS project_title, s.body_area, s.status, s.price_cents,
                {paid} AS paid_cents
         FROM sessions s
         INNER JOIN clients c ON c.id = s.client_id
         LEFT JOIN projects p ON p.id = s.project_id
         WHERE s.date BETWEEN ?1 AND ?2
         ORDER BY s.date, s.start_time IS NULL, s.start_time, s.created_at",
        paid = billing::SESSION_PAID_SQL
    );
    let rows = sqlx::query_as::<_, SessionRow>(&sql)
        .bind(day(from))
        .bind(day(to))
        .fetch_all(pool)
        .await?;

    let mut content = header(&[
        "Date",
        "Heure",
        "Durée (min)",
        "Nom",
        "Prénom",
        "Projet",
        "Zone",
        "Statut",
        "Prix (€)",
        "Réglé (€)",
        "Reste (€)",
    ]);
    for row in &rows {
        content.push_str(&line(&[
            row.date.clone(),
            row.start_time.clone().unwrap_or_default(),
            row.duration_minutes
                .map(|minutes| minutes.to_string())
                .unwrap_or_default(),
            text_cell(&row.last_name),
            text_cell(&row.first_name),
            optional(row.project_title.as_deref()),
            optional(row.body_area.as_deref()),
            status_label(row.status).to_string(),
            row.price_cents.map(euros_cell).unwrap_or_default(),
            euros_cell(row.paid_cents),
            row.price_cents
                .map(|price| euros_cell(price - row.paid_cents))
                .unwrap_or_default(),
        ]));
    }
    Ok(Csv {
        content,
        rows: rows.len(),
    })
}

#[derive(sqlx::FromRow)]
struct UsageRow {
    session_date: String,
    first_name: String,
    last_name: String,
    name: String,
    lot_number: String,
    expiration_date: String,
    after_opening_months: Option<i64>,
    single_use: bool,
    opened_at: Option<String>,
    quantity: i64,
    void_reason: Option<String>,
    category_id: Option<String>,
}

async fn traceability(pool: &SqlitePool, from: NaiveDate, to: NaiveDate) -> Result<Csv, LotError> {
    let rows = sqlx::query_as::<_, UsageRow>(
        "SELECT s.date AS session_date, c.first_name, c.last_name,
                l.name, l.lot_number, l.expiration_date, l.after_opening_months, l.single_use,
                u.opened_at,
                -- Quantité prise à la séance, même si le lien a été annulé depuis.
                CASE WHEN su.lot_id IS NOT NULL THEN COALESCE((
                    SELECT SUM(-m.quantity) FROM stock_movements m
                    WHERE m.session_id = su.session_id AND m.lot_id = su.lot_id
                      AND m.unit_id IS NULL AND m.type = 'CONSUMPTION'
                ), 0) ELSE 0 END AS quantity,
                v.reason AS void_reason,
                l.category_id
         FROM session_usages su
         INNER JOIN sessions s ON s.id = su.session_id
         INNER JOIN clients c ON c.id = s.client_id
         LEFT JOIN units u ON u.id = su.unit_id
         INNER JOIN lots l ON l.id = COALESCE(su.lot_id, u.lot_id)
         LEFT JOIN session_usage_voids v ON v.session_usage_id = su.id
         WHERE s.date BETWEEN ?1 AND ?2
         ORDER BY s.date, c.last_name COLLATE NOCASE, su.created_at",
    )
    .bind(day(from))
    .bind(day(to))
    .fetch_all(pool)
    .await?;

    let mut content = header(&[
        "Date de séance",
        "Nom",
        "Prénom",
        "Produit",
        "N° de lot",
        "Type",
        "Ouvert le",
        "Quantité",
        "Utilisable jusqu'au",
        "Périmé à la séance",
        "Lien annulé (motif)",
        "Catégorie",
    ]);
    let paths = categories::category_paths(pool).await?;
    for row in &rows {
        let useful_until = expiry::useful_until(
            &row.expiration_date,
            row.opened_at.as_deref(),
            row.after_opening_months,
        );
        let expired = NaiveDate::parse_from_str(&row.session_date, "%Y-%m-%d")
            .map(|session_day| expiry::is_expired(&useful_until, session_day))
            .unwrap_or(false);
        content.push_str(&line(&[
            row.session_date.clone(),
            text_cell(&row.last_name),
            text_cell(&row.first_name),
            text_cell(&row.name),
            text_cell(&row.lot_number),
            if row.single_use {
                "Usage unique"
            } else {
                "Encre (flacon)"
            }
            .to_string(),
            row.opened_at.clone().unwrap_or_default(),
            if row.single_use {
                row.quantity.to_string()
            } else {
                String::new()
            },
            useful_until,
            if expired { "Oui" } else { "Non" }.to_string(),
            optional(row.void_reason.as_deref()),
            optional(
                row.category_id
                    .as_ref()
                    .and_then(|id| paths.get(id))
                    .map(String::as_str),
            ),
        ]));
    }
    Ok(Csv {
        content,
        rows: rows.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_are_escaped_and_formulas_neutralised() {
        assert_eq!(text_cell("Martin"), "Martin");
        assert_eq!(text_cell("Dupont; fils"), "\"Dupont; fils\"");
        assert_eq!(text_cell("le \"rouge\""), "\"le \"\"rouge\"\"\"");
        assert_eq!(text_cell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
        assert_eq!(text_cell("+33 6"), "'+33 6");
        assert_eq!(text_cell("ligne 1\nligne 2"), "ligne 1 ligne 2");
    }

    #[test]
    fn amounts_use_a_decimal_comma() {
        assert_eq!(euros_cell(12_345), "123,45");
        assert_eq!(euros_cell(5), "0,05");
        assert_eq!(euros_cell(-500), "-5,00");
        assert_eq!(euros_cell(0), "0,00");
    }
}

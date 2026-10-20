//! Tableau de bord et rapports : lectures seules, aucune écriture.
//!
//! Les règles déjà écrites ailleurs sont réutilisées, pas recopiées :
//! péremption (`expiry`), reste à payer (`billing::SESSION_PAID_SQL`).

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;
use sqlx::SqlitePool;

use super::billing::{self, PaymentMethod};
use super::error::LotError;
use super::expiry;
use super::low_stock::{self, LowStockReport};
use super::sql::is_iso_date;
use crate::models::SessionStatus;

/// Un produit en stock est signalé quand sa limite tombe dans ce délai.
pub const EXPIRY_WARNING_DAYS: i64 = 30;
/// Une séance terminée sans documents signés est signalée pendant ce délai.
pub const UNSIGNED_LOOKBACK_DAYS: i64 = 30;
/// Séances à venir montrées sur l'accueil.
pub const UPCOMING_DAYS: i64 = 7;

const DAY: &str = "%Y-%m-%d";

fn day(date: NaiveDate) -> String {
    date.format(DAY).to_string()
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DaySession {
    pub id: String,
    pub client_id: String,
    pub client_first_name: String,
    pub client_last_name: String,
    pub project_title: Option<String>,
    pub date: String,
    pub start_time: Option<String>,
    pub duration_minutes: Option<i64>,
    pub status: SessionStatus,
    pub body_area: Option<String>,
    pub price_cents: Option<i64>,
    pub paid_cents: i64,
    pub health_saved: bool,
    pub health_signed: bool,
    pub consent_saved: bool,
    pub consent_signed: bool,
}

impl DaySession {
    /// Prix − déduit − payé, `None` sans prix.
    pub fn balance_cents(&self) -> Option<i64> {
        self.price_cents.map(|price| price - self.paid_cents)
    }
}

/// Une séance et les montants calculés côté Rust.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySessionView {
    #[serde(flatten)]
    pub session: DaySession,
    pub balance_cents: Option<i64>,
}

impl From<DaySession> for DaySessionView {
    fn from(session: DaySession) -> Self {
        Self {
            balance_cents: session.balance_cents(),
            session,
        }
    }
}

fn day_session_select() -> String {
    format!(
        "SELECT
            s.id, s.client_id,
            c.first_name AS client_first_name, c.last_name AS client_last_name,
            p.title AS project_title,
            s.date, s.start_time, s.duration_minutes, s.status, s.body_area, s.price_cents,
            {paid} AS paid_cents,
            EXISTS (SELECT 1 FROM session_forms f
                    WHERE f.session_id = s.id AND f.kind = 'HEALTH') AS health_saved,
            EXISTS (SELECT 1 FROM session_documents d
                    WHERE d.session_id = s.id AND d.kind = 'HEALTH_SIGNED'
                      AND d.voided_at IS NULL) AS health_signed,
            EXISTS (SELECT 1 FROM session_forms f
                    WHERE f.session_id = s.id AND f.kind = 'CONSENT') AS consent_saved,
            EXISTS (SELECT 1 FROM session_documents d
                    WHERE d.session_id = s.id AND d.kind = 'CONSENT_SIGNED'
                      AND d.voided_at IS NULL) AS consent_signed
         FROM sessions s
         INNER JOIN clients c ON c.id = s.client_id
         LEFT JOIN projects p ON p.id = s.project_id",
        paid = billing::SESSION_PAID_SQL
    )
}

const CHRONO: &str = "ORDER BY s.date, s.start_time IS NULL, s.start_time, s.created_at";

/// Produit en stock dont la limite d'utilisation est passée ou proche.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiringItem {
    pub lot_id: String,
    pub name: String,
    pub lot_number: String,
    /// `LOT` (usage unique), `OPENED` (pièce ouverte) ou `SEALED` (pièces scellées).
    pub kind: &'static str,
    /// Quantité en stock (usage unique) ou nombre de pièces.
    pub count: i64,
    pub opened_at: Option<String>,
    pub useful_until: String,
    pub expired: bool,
}

#[derive(sqlx::FromRow)]
struct StockRow {
    lot_id: String,
    name: String,
    lot_number: String,
    expiration_date: String,
    after_opening_months: Option<i64>,
    opened_at: Option<String>,
    single_use: bool,
    count: i64,
}

/// Produits en stock (lots d'usage unique, pièces ouvertes, pièces scellées).
async fn stock_items(pool: &SqlitePool, today: NaiveDate) -> Result<Vec<ExpiringItem>, LotError> {
    let rows = sqlx::query_as::<_, StockRow>(
        "SELECT l.id AS lot_id, l.name, l.lot_number, l.expiration_date, l.after_opening_months,
                NULL AS opened_at, 1 AS single_use,
                (SELECT COALESCE(SUM(m.quantity), 0) FROM stock_movements m
                  WHERE m.lot_id = l.id AND m.unit_id IS NULL) AS count
         FROM lots l
         WHERE l.single_use = 1
         UNION ALL
         SELECT l.id, l.name, l.lot_number, l.expiration_date, l.after_opening_months,
                u.opened_at, 0, COUNT(*)
         FROM units u
         INNER JOIN lots l ON l.id = u.lot_id
         WHERE (SELECT COALESCE(SUM(m.quantity), 0) FROM stock_movements m
                 WHERE m.unit_id = u.id) > 0
         GROUP BY l.id, u.opened_at",
    )
    .fetch_all(pool)
    .await?;

    let mut items: Vec<ExpiringItem> = rows
        .into_iter()
        .filter(|row| row.count > 0)
        .map(|row| {
            let useful_until = expiry::useful_until(
                &row.expiration_date,
                row.opened_at.as_deref(),
                row.after_opening_months,
            );
            ExpiringItem {
                expired: expiry::is_expired(&useful_until, today),
                kind: match (row.single_use, row.opened_at.is_some()) {
                    (true, _) => "LOT",
                    (false, true) => "OPENED",
                    (false, false) => "SEALED",
                },
                lot_id: row.lot_id,
                name: row.name,
                lot_number: row.lot_number,
                count: row.count,
                opened_at: row.opened_at,
                useful_until,
            }
        })
        .collect();
    items.sort_by(|a, b| {
        a.useful_until
            .cmp(&b.useful_until)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(items)
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DepositToSettle {
    pub deposit_id: String,
    pub session_id: String,
    pub client_id: String,
    pub client_first_name: String,
    pub client_last_name: String,
    pub session_date: String,
    pub session_status: SessionStatus,
    pub amount_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alerts {
    /// En stock alors que la limite est passée : à sortir du stock.
    pub expired: Vec<ExpiringItem>,
    /// Limite dans moins de `EXPIRY_WARNING_DAYS` jours.
    pub expiring_soon: Vec<ExpiringItem>,
    /// Séances passées encore « planifiées » : statut à mettre à jour.
    pub sessions_to_close: Vec<DaySessionView>,
    /// Séances terminées avec un reste à payer.
    pub unpaid: Vec<DaySessionView>,
    /// Acomptes en attente sur une séance terminée, annulée, reportée ou manquée.
    pub deposits_to_settle: Vec<DepositToSettle>,
    /// Séances terminées récemment sans questionnaire ou consentement signé.
    pub unsigned: Vec<DaySessionView>,
    /// Fiches produit et catégories sous leur seuil d'alerte.
    pub low_stock: LowStockReport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodTotal {
    pub method: PaymentMethod,
    pub cents: i64,
}

/// Synthèse d'une période (dates incluses).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummary {
    pub from: String,
    pub to: String,
    /// Paiements + acomptes reçus − acomptes remboursés.
    pub collected_cents: i64,
    pub payments_cents: i64,
    pub deposits_cents: i64,
    pub refunds_cents: i64,
    /// Paiements et acomptes reçus, par mode (avant remboursements).
    pub by_method: Vec<MethodTotal>,
    /// Somme des prix des séances terminées de la période.
    pub completed_price_cents: i64,
    pub sessions_completed: i64,
    pub sessions_planned: i64,
    pub sessions_cancelled: i64,
    pub sessions_no_show: i64,
    pub new_clients: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: String,
    pub today_sessions: Vec<DaySessionView>,
    pub upcoming: Vec<DaySessionView>,
    pub alerts: Alerts,
    pub month: PeriodSummary,
    pub previous_month: PeriodSummary,
}

fn month_bounds(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    let first = date.with_day(1).unwrap_or(date);
    let next = if first.month() == 12 {
        NaiveDate::from_ymd_opt(first.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(first.year(), first.month() + 1, 1)
    }
    .unwrap_or(first);
    (first, next - Duration::days(1))
}

async fn sessions_where(
    pool: &SqlitePool,
    condition: &str,
    binds: &[String],
) -> Result<Vec<DaySessionView>, LotError> {
    let sql = format!("{} WHERE {condition} {CHRONO}", day_session_select());
    let mut query = sqlx::query_as::<_, DaySession>(&sql);
    for value in binds {
        query = query.bind(value);
    }
    Ok(query
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(DaySessionView::from)
        .collect())
}

pub async fn get_dashboard(pool: &SqlitePool, today: NaiveDate) -> Result<Dashboard, LotError> {
    let today_text = day(today);
    let today_sessions =
        sessions_where(pool, "s.date = ?", std::slice::from_ref(&today_text)).await?;
    let upcoming = sessions_where(
        pool,
        "s.date > ? AND s.date <= ? AND s.status = 'PLANNED'",
        &[
            today_text.clone(),
            day(today + Duration::days(UPCOMING_DAYS)),
        ],
    )
    .await?;

    let stock = stock_items(pool, today).await?;
    let warning_limit = day(today + Duration::days(EXPIRY_WARNING_DAYS));
    let (expired, expiring_soon): (Vec<_>, Vec<_>) = stock
        .into_iter()
        .filter(|item| item.useful_until <= warning_limit)
        .partition(|item| item.expired);

    let sessions_to_close = sessions_where(
        pool,
        "s.date < ? AND s.status = 'PLANNED'",
        std::slice::from_ref(&today_text),
    )
    .await?;
    let unpaid = sessions_where(
        pool,
        &format!(
            "s.status = 'COMPLETED' AND s.price_cents IS NOT NULL
             AND s.price_cents > {}",
            billing::SESSION_PAID_SQL
        ),
        &[],
    )
    .await?;
    let unsigned = sessions_where(
        pool,
        "s.status = 'COMPLETED' AND s.date >= ? AND s.date <= ?
         AND (NOT EXISTS (SELECT 1 FROM session_documents d WHERE d.session_id = s.id
                          AND d.kind = 'HEALTH_SIGNED' AND d.voided_at IS NULL)
              OR NOT EXISTS (SELECT 1 FROM session_documents d WHERE d.session_id = s.id
                          AND d.kind = 'CONSENT_SIGNED' AND d.voided_at IS NULL))",
        &[
            day(today - Duration::days(UNSIGNED_LOOKBACK_DAYS)),
            today_text.clone(),
        ],
    )
    .await?;
    let deposits_to_settle = sqlx::query_as::<_, DepositToSettle>(
        "SELECT d.id AS deposit_id, s.id AS session_id, c.id AS client_id,
                c.first_name AS client_first_name, c.last_name AS client_last_name,
                s.date AS session_date, s.status AS session_status, d.amount_cents
         FROM deposits d
         INNER JOIN sessions s ON s.id = d.session_id
         INNER JOIN clients c ON c.id = d.client_id
         WHERE d.voided_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM deposit_outcomes o
                           WHERE o.deposit_id = d.id AND o.voided_at IS NULL)
           AND s.status != 'PLANNED'
         ORDER BY s.date, d.received_on",
    )
    .fetch_all(pool)
    .await?;

    let (month_from, month_to) = month_bounds(today);
    let (previous_from, previous_to) = month_bounds(month_from - Duration::days(1));

    Ok(Dashboard {
        today: today_text,
        today_sessions,
        upcoming,
        alerts: Alerts {
            expired,
            expiring_soon,
            sessions_to_close,
            unpaid,
            deposits_to_settle,
            unsigned,
            low_stock: low_stock::report(pool).await?,
        },
        month: summarize(pool, month_from, month_to).await?,
        previous_month: summarize(pool, previous_from, previous_to).await?,
    })
}

/// Synthèse d'une période choisie (écran Rapports).
pub async fn period_summary(
    pool: &SqlitePool,
    from: &str,
    to: &str,
) -> Result<PeriodSummary, LotError> {
    let (from, to) = parse_period(from, to)?;
    summarize(pool, from, to).await
}

pub fn parse_period(from: &str, to: &str) -> Result<(NaiveDate, NaiveDate), LotError> {
    let parse = |value: &str| {
        if !is_iso_date(value) {
            return None;
        }
        NaiveDate::parse_from_str(value, DAY).ok()
    };
    match (parse(from), parse(to)) {
        (Some(from), Some(to)) if from <= to => {
            if (to - from).num_days() > 3700 {
                Err(LotError::Invalid("La période ne peut pas dépasser dix ans"))
            } else {
                Ok((from, to))
            }
        }
        (Some(_), Some(_)) => Err(LotError::Invalid(
            "La date de début doit précéder la date de fin",
        )),
        _ => Err(LotError::Invalid(
            "Les dates doivent être au format AAAA-MM-JJ",
        )),
    }
}

async fn summarize(
    pool: &SqlitePool,
    from: NaiveDate,
    to: NaiveDate,
) -> Result<PeriodSummary, LotError> {
    let (from, to) = (day(from), day(to));

    let received: Vec<(PaymentMethod, i64, i64)> = sqlx::query_as(
        "SELECT method,
                SUM(CASE WHEN kind = 'P' THEN amount_cents ELSE 0 END),
                SUM(CASE WHEN kind = 'D' THEN amount_cents ELSE 0 END)
         FROM (
            SELECT 'P' AS kind, method, amount_cents FROM payments
             WHERE voided_at IS NULL AND paid_on BETWEEN ?1 AND ?2
            UNION ALL
            SELECT 'D', method, amount_cents FROM deposits
             WHERE voided_at IS NULL AND received_on BETWEEN ?1 AND ?2
         )
         GROUP BY method",
    )
    .bind(&from)
    .bind(&to)
    .fetch_all(pool)
    .await?;

    // Remboursement daté du jour où il a été enregistré (heure locale).
    let refunds_cents: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(d.amount_cents), 0)
         FROM deposit_outcomes o
         INNER JOIN deposits d ON d.id = o.deposit_id
         WHERE o.outcome = 'REFUNDED' AND o.voided_at IS NULL AND d.voided_at IS NULL
           AND date(o.created_at, 'localtime') BETWEEN ?1 AND ?2",
    )
    .bind(&from)
    .bind(&to)
    .fetch_one(pool)
    .await?;

    let counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
            COALESCE(SUM(status = 'COMPLETED'), 0),
            COALESCE(SUM(status = 'PLANNED'), 0),
            COALESCE(SUM(status IN ('CANCELLED', 'RESCHEDULED')), 0),
            COALESCE(SUM(status = 'NO_SHOW'), 0),
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN price_cents ELSE 0 END), 0)
         FROM sessions WHERE date BETWEEN ?1 AND ?2",
    )
    .bind(&from)
    .bind(&to)
    .fetch_one(pool)
    .await?;

    let new_clients: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM clients WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2",
    )
    .bind(&from)
    .bind(&to)
    .fetch_one(pool)
    .await?;

    let payments_cents = received.iter().map(|(_, p, _)| p).sum::<i64>();
    let deposits_cents = received.iter().map(|(_, _, d)| d).sum::<i64>();
    let mut by_method: Vec<MethodTotal> = received
        .into_iter()
        .map(|(method, payments, deposits)| MethodTotal {
            method,
            cents: payments + deposits,
        })
        .filter(|total| total.cents != 0)
        .collect();
    by_method.sort_by_key(|total| {
        (
            std::cmp::Reverse(total.cents),
            format!("{:?}", total.method),
        )
    });

    Ok(PeriodSummary {
        from,
        to,
        collected_cents: payments_cents + deposits_cents - refunds_cents,
        payments_cents,
        deposits_cents,
        refunds_cents,
        by_method,
        completed_price_cents: counts.4,
        sessions_completed: counts.0,
        sessions_planned: counts.1,
        sessions_cancelled: counts.2,
        sessions_no_show: counts.3,
        new_clients,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, DAY).unwrap()
    }

    #[test]
    fn month_bounds_handle_december_and_february() {
        assert_eq!(
            month_bounds(date("2026-12-15")),
            (date("2026-12-01"), date("2026-12-31"))
        );
        assert_eq!(
            month_bounds(date("2028-02-10")),
            (date("2028-02-01"), date("2028-02-29"))
        );
    }

    #[test]
    fn periods_are_checked() {
        assert!(parse_period("2026-10-01", "2026-10-31").is_ok());
        assert!(parse_period("2026-10-31", "2026-10-01").is_err());
        assert!(parse_period("2026-10", "2026-10-31").is_err());
        assert!(parse_period("2000-01-01", "2026-10-31").is_err());
    }
}

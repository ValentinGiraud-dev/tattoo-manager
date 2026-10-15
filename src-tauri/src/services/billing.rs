//! Acomptes et paiements.
//!
//! Tout est en centimes. Comme le stock, l'argent est un historique : rien ne se
//! modifie ni ne s'efface, une saisie erronée s'annule avec un motif (les triggers de
//! la migration 009 le garantissent aussi en base).
//!
//! Un acompte est versé pour un projet ou pour une séance. Tant qu'il n'a pas d'issue
//! active, il est « en attente ». Ses issues possibles :
//! - déduit (`APPLIED`) d'une séance du même client, ce qui réduit son reste à payer ;
//! - perdu (`FORFEITED`), conservé par l'atelier, par exemple après une absence ;
//! - remboursé (`REFUNDED`).
//!
//! Reste à payer d'une séance = prix − acomptes déduits − paiements.

use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};

use super::error::LotError;
use super::expiry;
use super::sql::{clean, is_iso_date, NOW};

/// Montant maximal d'une saisie (100 000 €) : protège des fautes de frappe.
pub const MAX_AMOUNT_CENTS: i64 = 10_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentMethod {
    Cash,
    Card,
    Transfer,
    Check,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OutcomeKind {
    Applied,
    Forfeited,
    Refunded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DepositStatus {
    /// Versé, sans issue : disponible pour une séance.
    Held,
    Applied,
    Forfeited,
    Refunded,
    /// Saisie annulée.
    Voided,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DepositView {
    pub id: String,
    pub client_id: String,
    pub project_id: Option<String>,
    pub project_title: Option<String>,
    pub session_id: Option<String>,
    pub session_date: Option<String>,
    pub amount_cents: i64,
    pub method: PaymentMethod,
    pub received_on: String,
    pub note: Option<String>,
    pub created_at: String,
    pub void_reason: Option<String>,
    pub voided_at: Option<String>,
    pub outcome_id: Option<String>,
    pub outcome: Option<OutcomeKind>,
    pub outcome_session_id: Option<String>,
    pub outcome_session_date: Option<String>,
    pub outcome_reason: Option<String>,
    pub outcome_at: Option<String>,
    #[sqlx(skip)]
    pub status: Option<DepositStatus>,
}

impl DepositView {
    fn with_status(mut self) -> Self {
        self.status = Some(self.computed_status());
        self
    }

    fn computed_status(&self) -> DepositStatus {
        if self.voided_at.is_some() {
            return DepositStatus::Voided;
        }
        match self.outcome {
            None => DepositStatus::Held,
            Some(OutcomeKind::Applied) => DepositStatus::Applied,
            Some(OutcomeKind::Forfeited) => DepositStatus::Forfeited,
            Some(OutcomeKind::Refunded) => DepositStatus::Refunded,
        }
    }
}

const DEPOSIT_SELECT: &str = "SELECT
    d.id, d.client_id, d.project_id, p.title AS project_title,
    d.session_id, ds.date AS session_date,
    d.amount_cents, d.method, d.received_on, d.note, d.created_at,
    d.void_reason, d.voided_at,
    o.id AS outcome_id, o.outcome, o.session_id AS outcome_session_id,
    os.date AS outcome_session_date, o.reason AS outcome_reason, o.created_at AS outcome_at
 FROM deposits d
 LEFT JOIN projects p ON p.id = d.project_id
 LEFT JOIN sessions ds ON ds.id = d.session_id
 LEFT JOIN deposit_outcomes o ON o.deposit_id = d.id AND o.voided_at IS NULL
 LEFT JOIN sessions os ON os.id = o.session_id";

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PaymentView {
    pub id: String,
    pub session_id: String,
    pub amount_cents: i64,
    pub method: PaymentMethod,
    pub paid_on: String,
    pub note: Option<String>,
    pub created_at: String,
    pub void_reason: Option<String>,
    pub voided_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BillingState {
    /// Pas de prix renseigné.
    NoPrice,
    Unpaid,
    Partial,
    Paid,
    Overpaid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBilling {
    pub session_id: String,
    pub session_status: String,
    pub price_cents: Option<i64>,
    /// Acomptes déduits de cette séance.
    pub applied_cents: i64,
    /// Paiements encaissés pour cette séance (hors annulés).
    pub payments_cents: i64,
    pub paid_cents: i64,
    /// Prix − déduit − payé. Négatif : trop-perçu. `None` sans prix.
    pub balance_cents: Option<i64>,
    pub state: BillingState,
    /// Acomptes de la séance, de son projet, ou dont l'issue concerne la séance.
    pub deposits: Vec<DepositView>,
    pub payments: Vec<PaymentView>,
}

fn billing_state(price: Option<i64>, paid: i64) -> BillingState {
    match price {
        None => BillingState::NoPrice,
        Some(price) if paid == 0 && price > 0 => BillingState::Unpaid,
        Some(price) if paid < price => BillingState::Partial,
        Some(price) if paid == price => BillingState::Paid,
        Some(_) => BillingState::Overpaid,
    }
}

// ---------------------------------------------------------------------------
// Validation commune
// ---------------------------------------------------------------------------

fn check_amount(amount_cents: i64) -> Result<(), LotError> {
    if amount_cents <= 0 {
        return Err(LotError::Invalid("Le montant doit être positif"));
    }
    if amount_cents > MAX_AMOUNT_CENTS {
        return Err(LotError::Invalid("Le montant est trop élevé"));
    }
    Ok(())
}

/// Date d'encaissement : format valide et pas dans le futur.
fn check_money_date(date: &str) -> Result<String, LotError> {
    let date = date.trim().to_string();
    if !is_iso_date(&date) {
        return Err(LotError::Invalid("La date doit être au format AAAA-MM-JJ"));
    }
    if date > expiry::today().format("%Y-%m-%d").to_string() {
        return Err(LotError::Invalid(
            "La date d'encaissement ne peut pas être dans le futur",
        ));
    }
    Ok(date)
}

fn required_reason(reason: &str) -> Result<String, LotError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(LotError::Invalid("Le motif d'annulation est obligatoire"));
    }
    Ok(reason.to_string())
}

#[derive(sqlx::FromRow)]
struct SessionRef {
    client_id: String,
    project_id: Option<String>,
    status: String,
}

async fn session_ref(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
) -> Result<SessionRef, LotError> {
    sqlx::query_as::<_, SessionRef>(
        "SELECT client_id, project_id, status FROM sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(LotError::Invalid("La séance est introuvable"))
}

async fn deposit_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    deposit_id: &str,
) -> Result<DepositView, LotError> {
    let sql = format!("{DEPOSIT_SELECT} WHERE d.id = ?");
    sqlx::query_as::<_, DepositView>(&sql)
        .bind(deposit_id)
        .fetch_optional(&mut **tx)
        .await?
        .map(DepositView::with_status)
        .ok_or(LotError::NotFound)
}

pub async fn get_deposit(pool: &SqlitePool, deposit_id: &str) -> Result<DepositView, LotError> {
    let sql = format!("{DEPOSIT_SELECT} WHERE d.id = ?");
    sqlx::query_as::<_, DepositView>(&sql)
        .bind(deposit_id)
        .fetch_optional(pool)
        .await?
        .map(DepositView::with_status)
        .ok_or(LotError::NotFound)
}

// ---------------------------------------------------------------------------
// Acomptes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositInput {
    pub project_id: Option<String>,
    pub session_id: Option<String>,
    pub amount_cents: i64,
    pub method: PaymentMethod,
    pub received_on: String,
    pub note: Option<String>,
}

pub async fn record_deposit(
    pool: &SqlitePool,
    input: DepositInput,
) -> Result<DepositView, LotError> {
    check_amount(input.amount_cents)?;
    let received_on = check_money_date(&input.received_on)?;
    let project_id = clean(input.project_id);
    let session_id = clean(input.session_id);

    let mut tx = pool.begin().await?;
    let client_id = match (&project_id, &session_id) {
        (None, None) => {
            return Err(LotError::Invalid(
                "Un acompte se rattache à un projet ou à une séance",
            ));
        }
        (Some(project_id), session_id) => {
            let owner: Option<String> =
                sqlx::query_scalar("SELECT client_id FROM projects WHERE id = ?")
                    .bind(project_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            let owner = owner.ok_or(LotError::Invalid("Le projet est introuvable"))?;
            if let Some(session_id) = session_id {
                let session = session_ref(&mut tx, session_id).await?;
                if session.project_id.as_deref() != Some(project_id.as_str()) {
                    return Err(LotError::Invalid(
                        "Cette séance ne fait pas partie du projet",
                    ));
                }
            }
            owner
        }
        (None, Some(session_id)) => session_ref(&mut tx, session_id).await?.client_id,
    };

    let id: String = sqlx::query_scalar("SELECT lower(hex(randomblob(16)))")
        .fetch_one(&mut *tx)
        .await?;
    let sql = format!(
        "INSERT INTO deposits
            (id, client_id, project_id, session_id, amount_cents, method, received_on, note,
             created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, {NOW})"
    );
    sqlx::query(&sql)
        .bind(&id)
        .bind(&client_id)
        .bind(&project_id)
        .bind(&session_id)
        .bind(input.amount_cents)
        .bind(input.method)
        .bind(&received_on)
        .bind(clean(input.note))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_deposit(pool, &id).await
}

pub async fn void_deposit(
    pool: &SqlitePool,
    deposit_id: &str,
    reason: &str,
) -> Result<DepositView, LotError> {
    let reason = required_reason(reason)?;
    let mut tx = pool.begin().await?;
    let deposit = deposit_in_tx(&mut tx, deposit_id).await?;
    match deposit.computed_status() {
        DepositStatus::Held => {}
        DepositStatus::Voided => return Err(LotError::Invalid("Cet acompte est déjà annulé")),
        _ => {
            return Err(LotError::Invalid(
                "Cet acompte a déjà été déduit, perdu ou remboursé : annule d'abord cette issue",
            ));
        }
    }
    let sql = format!(
        "UPDATE deposits SET void_reason = ?, voided_at = {NOW} WHERE id = ? AND voided_at IS NULL"
    );
    sqlx::query(&sql)
        .bind(&reason)
        .bind(deposit_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_deposit(pool, deposit_id).await
}

fn require_held(deposit: &DepositView) -> Result<(), LotError> {
    match deposit.computed_status() {
        DepositStatus::Held => Ok(()),
        DepositStatus::Applied => Err(LotError::Invalid(
            "Cet acompte est déjà déduit d'une séance",
        )),
        DepositStatus::Forfeited => {
            Err(LotError::Invalid("Cet acompte est déjà marqué comme perdu"))
        }
        DepositStatus::Refunded => Err(LotError::Invalid("Cet acompte est déjà remboursé")),
        DepositStatus::Voided => Err(LotError::Invalid("Cet acompte est annulé")),
    }
}

async fn insert_outcome(
    tx: &mut Transaction<'_, Sqlite>,
    deposit_id: &str,
    outcome: OutcomeKind,
    session_id: Option<&str>,
    reason: Option<String>,
) -> Result<(), LotError> {
    let sql = format!(
        "INSERT INTO deposit_outcomes (id, deposit_id, outcome, session_id, reason, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, {NOW})"
    );
    sqlx::query(&sql)
        .bind(deposit_id)
        .bind(outcome)
        .bind(session_id)
        .bind(reason)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Déduit un acompte en attente du prix d'une séance du même client.
pub async fn apply_deposit(
    pool: &SqlitePool,
    deposit_id: &str,
    session_id: &str,
) -> Result<DepositView, LotError> {
    let mut tx = pool.begin().await?;
    let deposit = deposit_in_tx(&mut tx, deposit_id).await?;
    require_held(&deposit)?;
    let session = session_ref(&mut tx, session_id).await?;
    if session.client_id != deposit.client_id {
        return Err(LotError::Invalid(
            "Cet acompte a été versé par un autre client",
        ));
    }
    let belongs = deposit.session_id.as_deref() == Some(session_id)
        || (deposit.project_id.is_some() && deposit.project_id == session.project_id);
    if !belongs {
        return Err(LotError::Invalid(
            "Cet acompte n'est rattaché ni à cette séance ni à son projet",
        ));
    }
    if !matches!(session.status.as_str(), "PLANNED" | "COMPLETED") {
        return Err(LotError::Invalid(
            "Un acompte ne se déduit que d'une séance prévue ou terminée",
        ));
    }
    insert_outcome(
        &mut tx,
        deposit_id,
        OutcomeKind::Applied,
        Some(session_id),
        None,
    )
    .await?;
    tx.commit().await?;
    get_deposit(pool, deposit_id).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleDepositInput {
    pub deposit_id: String,
    /// `FORFEITED` ou `REFUNDED`. Pour déduire, voir `apply_deposit`.
    pub outcome: OutcomeKind,
    /// Séance concernée (absence, annulation), si connue.
    pub session_id: Option<String>,
    pub reason: Option<String>,
}

/// Marque un acompte en attente comme perdu (conservé par l'atelier) ou remboursé.
pub async fn settle_deposit(
    pool: &SqlitePool,
    input: SettleDepositInput,
) -> Result<DepositView, LotError> {
    if input.outcome == OutcomeKind::Applied {
        return Err(LotError::Invalid(
            "Pour déduire un acompte, choisis la séance concernée",
        ));
    }
    let session_id = clean(input.session_id);
    let mut tx = pool.begin().await?;
    let deposit = deposit_in_tx(&mut tx, &input.deposit_id).await?;
    require_held(&deposit)?;
    if let Some(session_id) = &session_id {
        let session = session_ref(&mut tx, session_id).await?;
        if session.client_id != deposit.client_id {
            return Err(LotError::Invalid(
                "Cet acompte a été versé par un autre client",
            ));
        }
    }
    insert_outcome(
        &mut tx,
        &input.deposit_id,
        input.outcome,
        session_id.as_deref(),
        clean(input.reason),
    )
    .await?;
    tx.commit().await?;
    get_deposit(pool, &input.deposit_id).await
}

/// Annule l'issue d'un acompte saisie par erreur : il redevient « en attente ».
pub async fn void_outcome(
    pool: &SqlitePool,
    outcome_id: &str,
    reason: &str,
) -> Result<DepositView, LotError> {
    let reason = required_reason(reason)?;
    let mut tx = pool.begin().await?;
    let row: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT deposit_id, voided_at FROM deposit_outcomes WHERE id = ?")
            .bind(outcome_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (deposit_id, voided_at) = row.ok_or(LotError::NotFound)?;
    if voided_at.is_some() {
        return Err(LotError::Invalid("Cette issue est déjà annulée"));
    }
    let sql = format!(
        "UPDATE deposit_outcomes SET void_reason = ?, voided_at = {NOW}
         WHERE id = ? AND voided_at IS NULL"
    );
    sqlx::query(&sql)
        .bind(&reason)
        .bind(outcome_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_deposit(pool, &deposit_id).await
}

// ---------------------------------------------------------------------------
// Paiements
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub session_id: String,
    pub amount_cents: i64,
    pub method: PaymentMethod,
    pub paid_on: String,
    pub note: Option<String>,
}

const PAYMENT_SELECT: &str = "SELECT id, session_id, amount_cents, method, paid_on, note,
    created_at, void_reason, voided_at FROM payments";

pub async fn record_payment(
    pool: &SqlitePool,
    input: PaymentInput,
) -> Result<PaymentView, LotError> {
    check_amount(input.amount_cents)?;
    let paid_on = check_money_date(&input.paid_on)?;
    let mut tx = pool.begin().await?;
    session_ref(&mut tx, &input.session_id).await?;
    let id: String = sqlx::query_scalar("SELECT lower(hex(randomblob(16)))")
        .fetch_one(&mut *tx)
        .await?;
    let sql = format!(
        "INSERT INTO payments (id, session_id, amount_cents, method, paid_on, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, {NOW})"
    );
    sqlx::query(&sql)
        .bind(&id)
        .bind(&input.session_id)
        .bind(input.amount_cents)
        .bind(input.method)
        .bind(&paid_on)
        .bind(clean(input.note))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_payment(pool, &id).await
}

pub async fn get_payment(pool: &SqlitePool, id: &str) -> Result<PaymentView, LotError> {
    let sql = format!("{PAYMENT_SELECT} WHERE id = ?");
    sqlx::query_as::<_, PaymentView>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(LotError::NotFound)
}

pub async fn void_payment(
    pool: &SqlitePool,
    payment_id: &str,
    reason: &str,
) -> Result<PaymentView, LotError> {
    let reason = required_reason(reason)?;
    let payment = get_payment(pool, payment_id).await?;
    if payment.voided_at.is_some() {
        return Err(LotError::Invalid("Ce paiement est déjà annulé"));
    }
    let sql = format!(
        "UPDATE payments SET void_reason = ?, voided_at = {NOW} WHERE id = ? AND voided_at IS NULL"
    );
    sqlx::query(&sql)
        .bind(&reason)
        .bind(payment_id)
        .execute(pool)
        .await?;
    get_payment(pool, payment_id).await
}

// ---------------------------------------------------------------------------
// Synthèses
// ---------------------------------------------------------------------------

pub async fn get_session_billing(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<SessionBilling, LotError> {
    let mut tx = pool.begin().await?;
    let session = session_ref(&mut tx, session_id).await?;
    let price: Option<i64> = sqlx::query_scalar("SELECT price_cents FROM sessions WHERE id = ?")
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;

    let sql = format!(
        "{DEPOSIT_SELECT}
         WHERE d.session_id = ?1
            OR (?2 IS NOT NULL AND d.project_id = ?2)
            OR o.session_id = ?1
         ORDER BY d.received_on, d.created_at"
    );
    let deposits: Vec<DepositView> = sqlx::query_as::<_, DepositView>(&sql)
        .bind(session_id)
        .bind(&session.project_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(DepositView::with_status)
        .collect();

    let sql = format!("{PAYMENT_SELECT} WHERE session_id = ? ORDER BY paid_on, created_at");
    let payments = sqlx::query_as::<_, PaymentView>(&sql)
        .bind(session_id)
        .fetch_all(pool)
        .await?;

    let applied_cents: i64 = deposits
        .iter()
        .filter(|d| {
            d.computed_status() == DepositStatus::Applied
                && d.outcome_session_id.as_deref() == Some(session_id)
        })
        .map(|d| d.amount_cents)
        .sum();
    let payments_cents: i64 = payments
        .iter()
        .filter(|p| p.voided_at.is_none())
        .map(|p| p.amount_cents)
        .sum();
    let paid_cents = applied_cents + payments_cents;

    Ok(SessionBilling {
        session_id: session_id.to_string(),
        session_status: session.status,
        price_cents: price,
        applied_cents,
        payments_cents,
        paid_cents,
        balance_cents: price.map(|price| price - paid_cents),
        state: billing_state(price, paid_cents),
        deposits,
        payments,
    })
}

/// Acomptes d'un projet : versés pour le projet ou pour une de ses séances.
pub async fn list_project_deposits(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<DepositView>, LotError> {
    let sql = format!(
        "{DEPOSIT_SELECT}
         WHERE d.project_id = ?1
            OR d.session_id IN (SELECT id FROM sessions WHERE project_id = ?1)
         ORDER BY d.received_on, d.created_at"
    );
    Ok(sqlx::query_as::<_, DepositView>(&sql)
        .bind(project_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(DepositView::with_status)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{billing_state, BillingState};

    #[test]
    fn the_billing_state_follows_price_and_payments() {
        assert_eq!(billing_state(None, 5000), BillingState::NoPrice);
        assert_eq!(billing_state(Some(20000), 0), BillingState::Unpaid);
        assert_eq!(billing_state(Some(20000), 5000), BillingState::Partial);
        assert_eq!(billing_state(Some(20000), 20000), BillingState::Paid);
        assert_eq!(billing_state(Some(20000), 25000), BillingState::Overpaid);
        assert_eq!(billing_state(Some(0), 0), BillingState::Paid);
    }
}

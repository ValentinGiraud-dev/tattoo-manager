use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::categories;
use super::error::LotError;
use super::expiry;
use super::product_sheets;
use super::sql::{self, NOW};
use super::stock::{self, MovementDraft, MovementType};

const MAX_BOTTLES: i64 = 500;
const MAX_QUANTITY: i64 = 100_000;

const SUMMARY_SELECT: &str = r#"
SELECT
    l.id,
    l.name,
    l.lot_number,
    l.creation_date,
    l.expiration_date,
    l.single_use,
    l.after_opening_months,
    l.product_url,
    l.category_id,
    l.product_id,
    p.name AS product_name,
    p.brand AS product_brand,
    l.created_at,
    l.updated_at,
    CASE
        WHEN l.single_use = 1 THEN COALESCE((
            SELECT SUM(m.quantity) FROM stock_movements m WHERE m.lot_id = l.id
        ), 0)
        ELSE (
            SELECT COUNT(*)
            FROM units u
            WHERE u.lot_id = l.id
              AND COALESCE((
                  SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id
              ), 0) > 0
        )
    END AS stock,
    CASE
        WHEN l.single_use = 1 THEN 0
        ELSE (
            SELECT COUNT(*)
            FROM units u
            WHERE u.lot_id = l.id
              AND u.opened_at IS NULL
              AND COALESCE((
                  SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id
              ), 0) > 0
        )
    END AS sealed_count,
    CASE
        WHEN l.single_use = 1 THEN 0
        ELSE (
            SELECT COUNT(*)
            FROM units u
            WHERE u.lot_id = l.id
              AND u.opened_at IS NOT NULL
              AND COALESCE((
                  SELECT SUM(m.quantity) FROM stock_movements m WHERE m.unit_id = u.id
              ), 0) > 0
        )
    END AS opened_count,
    (
        SELECT COUNT(*) FROM stock_movements m WHERE m.lot_id = l.id
    ) AS movement_count,
    (
        SELECT COUNT(DISTINCT su.session_id)
        FROM session_usages su
        LEFT JOIN units u ON u.id = su.unit_id
        WHERE su.lot_id = l.id OR u.lot_id = l.id
    ) AS session_count
FROM lots l
LEFT JOIN product_sheets p ON p.id = l.product_id
"#;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LotSummary {
    pub id: String,
    pub name: String,
    pub lot_number: String,
    pub creation_date: Option<String>,
    pub expiration_date: String,
    pub single_use: bool,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    pub category_id: Option<String>,
    /// « Aiguilles › RL ». Rempli en Rust depuis l'arbre des catégories.
    #[sqlx(skip)]
    pub category_path: Option<String>,
    /// Fiche produit du lot ; `None` pour un lot créé avant les fiches (à rattacher).
    pub product_id: Option<String>,
    pub product_name: Option<String>,
    pub product_brand: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub stock: i64,
    pub sealed_count: i64,
    pub opened_count: i64,
    pub movement_count: i64,
    /// Nombre de séances où ce lot (ou une de ses pièces) a servi.
    pub session_count: i64,
    /// Calculé en Rust (`expiry`), pas en SQL.
    #[sqlx(skip)]
    pub expired: bool,
}

impl LotSummary {
    fn with_expiry(mut self, today: chrono::NaiveDate) -> Self {
        self.expired = expiry::is_expired(&self.expiration_date, today);
        self
    }

    fn with_path(mut self, paths: &HashMap<String, String>) -> Self {
        self.category_path = self
            .category_id
            .as_ref()
            .and_then(|id| paths.get(id).cloned());
        self
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLotInput {
    pub name: String,
    pub lot_number: String,
    pub creation_date: Option<String>,
    pub expiration_date: String,
    pub single_use: bool,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    pub quantity: i64,
    /// Catégorie de rangement (`None` : sans catégorie). Ignorée avec une fiche produit.
    #[serde(default)]
    pub category_id: Option<String>,
    /// Fiche produit : nom, type, durée après ouverture, lien et catégorie en sont
    /// repris (les champs du même nom ci-dessus sont alors ignorés).
    #[serde(default)]
    pub product_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLotInput {
    pub name: String,
    pub lot_number: String,
    pub creation_date: Option<String>,
    pub expiration_date: String,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    /// Modifiable même pour un lot déjà utilisé : ce n'est pas son identité.
    #[serde(default)]
    pub category_id: Option<String>,
}

struct NormalizedLot {
    name: String,
    lot_number: String,
    creation_date: Option<String>,
    expiration_date: String,
    after_opening_months: Option<i64>,
    product_url: Option<String>,
}

fn normalize_shared(
    name: String,
    lot_number: String,
    creation_date: Option<String>,
    expiration_date: String,
    single_use: bool,
    after_opening_months: Option<i64>,
    product_url: Option<String>,
) -> Result<NormalizedLot, LotError> {
    let name = name.trim().to_string();
    let lot_number = lot_number.trim().to_string();
    let expiration_date = expiration_date.trim().to_string();
    if name.is_empty() {
        return Err(LotError::Invalid("Le nom est obligatoire"));
    }
    if lot_number.is_empty() {
        return Err(LotError::Invalid("Le numéro de lot est obligatoire"));
    }
    if !sql::is_iso_date(&expiration_date) {
        return Err(LotError::Invalid(
            "La date d'expiration doit être au format AAAA-MM-JJ",
        ));
    }
    let creation_date = sql::clean(creation_date);
    if let Some(ref date) = creation_date {
        if !sql::is_iso_date(date) {
            return Err(LotError::Invalid(
                "La date de fabrication doit être au format AAAA-MM-JJ",
            ));
        }
    }
    let after_opening_months = if single_use {
        if after_opening_months.is_some() {
            return Err(LotError::Invalid(
                "Un usage unique n'a pas de durée après ouverture",
            ));
        }
        None
    } else if let Some(months) = after_opening_months {
        if months <= 0 {
            return Err(LotError::Invalid(
                "La durée après ouverture doit être un nombre de mois positif",
            ));
        }
        Some(months)
    } else {
        None
    };

    Ok(NormalizedLot {
        name,
        lot_number,
        creation_date,
        expiration_date,
        after_opening_months,
        product_url: sql::clean(product_url),
    })
}

fn check_quantity(single_use: bool, quantity: i64) -> Result<(), LotError> {
    if quantity <= 0 {
        return Err(LotError::Invalid("La quantité doit être positive"));
    }
    let max = if single_use {
        MAX_QUANTITY
    } else {
        MAX_BOTTLES
    };
    if quantity > max {
        return Err(LotError::Invalid("La quantité est trop grande"));
    }
    Ok(())
}

pub async fn list_lots(
    pool: &SqlitePool,
    search: Option<String>,
) -> Result<Vec<LotSummary>, LotError> {
    let pattern = sql::like_pattern(search);
    let sql = format!(
        "{SUMMARY_SELECT}
         WHERE ?1 IS NULL
            OR l.name LIKE ?1 ESCAPE '\\'
            OR l.lot_number LIKE ?1 ESCAPE '\\'
         ORDER BY l.name COLLATE NOCASE, l.lot_number COLLATE NOCASE"
    );
    let lots = sqlx::query_as::<_, LotSummary>(&sql)
        .bind(pattern)
        .fetch_all(pool)
        .await?;
    let today = expiry::today();
    let paths = categories::category_paths(pool).await?;
    Ok(lots
        .into_iter()
        .map(|lot| lot.with_expiry(today).with_path(&paths))
        .collect())
}

pub async fn get_lot(pool: &SqlitePool, id: &str) -> Result<LotSummary, LotError> {
    let sql = format!("{SUMMARY_SELECT} WHERE l.id = ?");
    let lot = sqlx::query_as::<_, LotSummary>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(LotError::NotFound)?;
    let paths = categories::category_paths(pool).await?;
    Ok(lot.with_expiry(expiry::today()).with_path(&paths))
}

pub async fn find_lot(
    pool: &SqlitePool,
    name: &str,
    lot_number: &str,
) -> Result<Option<LotSummary>, LotError> {
    let name = name.trim();
    let lot_number = lot_number.trim();
    if name.is_empty() || lot_number.is_empty() {
        return Ok(None);
    }
    let sql = format!(
        "{SUMMARY_SELECT}
         WHERE l.name COLLATE NOCASE = ? AND l.lot_number COLLATE NOCASE = ?"
    );
    let lot = sqlx::query_as::<_, LotSummary>(&sql)
        .bind(name)
        .bind(lot_number)
        .fetch_optional(pool)
        .await?;
    let paths = categories::category_paths(pool).await?;
    Ok(lot.map(|lot| lot.with_expiry(expiry::today()).with_path(&paths)))
}

pub async fn create_lot(pool: &SqlitePool, input: CreateLotInput) -> Result<LotSummary, LotError> {
    let mut tx = pool.begin().await?;
    let sheet = match sql::clean(input.product_id) {
        Some(id) => Some(product_sheets::template(&mut tx, &id).await?),
        None => None,
    };
    let (name, single_use, after_opening_months, product_url, category_id) = match &sheet {
        Some(sheet) => (
            sheet.lot_name(),
            sheet.single_use,
            sheet.after_opening_months,
            sheet.product_url.clone(),
            sheet.category_id.clone(),
        ),
        None => (
            input.name,
            input.single_use,
            input.after_opening_months,
            input.product_url,
            input.category_id,
        ),
    };
    let normalized = normalize_shared(
        name,
        input.lot_number,
        input.creation_date,
        input.expiration_date,
        single_use,
        after_opening_months,
        product_url,
    )?;
    check_quantity(single_use, input.quantity)?;

    let category_id = categories::check_lot_category(&mut tx, category_id).await?;
    let existing: Option<(String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, single_use, product_id FROM lots
         WHERE name COLLATE NOCASE = ? AND lot_number COLLATE NOCASE = ?",
    )
    .bind(&normalized.name)
    .bind(&normalized.lot_number)
    .fetch_optional(&mut *tx)
    .await?;

    let lot_id = if let Some((existing_id, existing_single_use, existing_product)) = existing {
        if existing_single_use != single_use {
            return Err(LotError::Invalid("Ce lot existe déjà avec un autre type"));
        }
        if let Some(sheet) = &sheet {
            match existing_product {
                Some(other) if other != sheet.id => {
                    return Err(LotError::Invalid(
                        "Ce numéro de lot est déjà enregistré sous une autre fiche produit",
                    ))
                }
                Some(_) => {}
                // Lot reçu avant les fiches : la réception le rattache.
                None => {
                    product_sheets::attach(&mut tx, &existing_id, &sheet.id).await?;
                }
            }
        }
        add_stock(&mut tx, &existing_id, single_use, input.quantity).await?;
        if sheet.is_none() && category_id.is_some() {
            sqlx::query("UPDATE lots SET category_id = ? WHERE id = ?")
                .bind(&category_id)
                .bind(&existing_id)
                .execute(&mut *tx)
                .await?;
        }
        existing_id
    } else {
        let sql = format!(
            "INSERT INTO lots
                (id, name, lot_number, creation_date, expiration_date, single_use,
                 after_opening_months, product_url, category_id, product_id,
                 created_at, updated_at)
             VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
             RETURNING id"
        );
        let lot_id: String = sqlx::query_scalar(&sql)
            .bind(&normalized.name)
            .bind(&normalized.lot_number)
            .bind(&normalized.creation_date)
            .bind(&normalized.expiration_date)
            .bind(if single_use { 1 } else { 0 })
            .bind(normalized.after_opening_months)
            .bind(&normalized.product_url)
            .bind(&category_id)
            .bind(sheet.as_ref().map(|sheet| sheet.id.as_str()))
            .fetch_one(&mut *tx)
            .await?;
        add_stock(&mut tx, &lot_id, single_use, input.quantity).await?;
        lot_id
    };

    tx.commit().await?;
    get_lot(pool, &lot_id).await
}

/// Message affiché quand on tente de modifier l'identité d'un lot déjà tracé.
pub(crate) const LOT_IDENTITY_LOCKED: &str = "Ce lot a déjà servi en séance : son nom, son numéro, sa péremption et sa durée après ouverture ne sont plus modifiables. Si une valeur est fausse, crée un nouveau lot avec les bonnes informations.";

/// Vrai si le lot, ou une de ses pièces, est lié à au moins une séance.
pub(crate) async fn lot_used_in_sessions(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    lot_id: &str,
) -> Result<bool, LotError> {
    let used: Option<i64> = sqlx::query_scalar(
        "SELECT 1
         FROM session_usages su
         LEFT JOIN units u ON u.id = su.unit_id
         WHERE su.lot_id = ?1 OR u.lot_id = ?1
         LIMIT 1",
    )
    .bind(lot_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(used.is_some())
}

/// Lot avant modification : type, identité tracée, fiche produit.
type CurrentLot = (bool, String, String, String, Option<i64>, Option<String>);

pub async fn update_lot(
    pool: &SqlitePool,
    id: &str,
    input: UpdateLotInput,
) -> Result<LotSummary, LotError> {
    let mut tx = pool.begin().await?;
    let current: Option<CurrentLot> = sqlx::query_as(
        "SELECT single_use, name, lot_number, expiration_date, after_opening_months, product_id
             FROM lots WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((single_use, name, lot_number, expiration_date, after_opening_months, product_id)) =
        current
    else {
        return Err(LotError::NotFound);
    };
    let normalized = normalize_shared(
        input.name,
        input.lot_number,
        input.creation_date,
        input.expiration_date,
        single_use,
        input.after_opening_months,
        input.product_url,
    )?;
    // Rattaché à une fiche : le lot est rangé là où est sa fiche.
    let category_id = match &product_id {
        Some(product_id) => {
            product_sheets::template(&mut tx, product_id)
                .await?
                .category_id
        }
        None => categories::check_lot_category(&mut tx, input.category_id).await?,
    };

    // Un lot déjà utilisé en séance garde son identité : ce sont ces valeurs
    // qui figurent dans l'historique de traçabilité des clients.
    let identity_changed = normalized.name != name
        || normalized.lot_number != lot_number
        || normalized.expiration_date != expiration_date
        || normalized.after_opening_months != after_opening_months;
    if identity_changed && lot_used_in_sessions(&mut tx, id).await? {
        return Err(LotError::Invalid(LOT_IDENTITY_LOCKED));
    }

    let conflict: Option<String> = sqlx::query_scalar(
        "SELECT id FROM lots
         WHERE name COLLATE NOCASE = ? AND lot_number COLLATE NOCASE = ? AND id != ?",
    )
    .bind(&normalized.name)
    .bind(&normalized.lot_number)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if conflict.is_some() {
        return Err(LotError::Invalid(
            "Un lot avec ce nom et ce numéro existe déjà",
        ));
    }

    let sql = format!(
        "UPDATE lots
         SET name = ?, lot_number = ?, creation_date = ?, expiration_date = ?,
             after_opening_months = ?, product_url = ?, category_id = ?, updated_at = {NOW}
         WHERE id = ?"
    );
    sqlx::query(&sql)
        .bind(&normalized.name)
        .bind(&normalized.lot_number)
        .bind(&normalized.creation_date)
        .bind(&normalized.expiration_date)
        .bind(normalized.after_opening_months)
        .bind(&normalized.product_url)
        .bind(&category_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_lot(pool, id).await
}

pub async fn record_movement(
    pool: &SqlitePool,
    input: stock::RecordMovementInput,
) -> Result<LotSummary, LotError> {
    let movement_type = MovementType::parse(input.movement_type.trim())?;
    if movement_type == MovementType::Consumption {
        return Err(LotError::Invalid(
            "La consommation d'un usage unique passe par une séance",
        ));
    }
    let quantity = movement_type.stored_quantity(input.quantity)?;
    let reason = sql::clean(input.reason);

    let mut tx = pool.begin().await?;
    let single_use: Option<bool> = sqlx::query_scalar("SELECT single_use FROM lots WHERE id = ?")
        .bind(&input.lot_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(single_use) = single_use else {
        return Err(LotError::NotFound);
    };
    if !single_use {
        return Err(LotError::Invalid(
            "Le stock d'un usage multiple se gère pièce par pièce",
        ));
    }
    stock::apply_movement(
        &mut tx,
        MovementDraft {
            lot_id: input.lot_id.clone(),
            unit_id: None,
            session_id: None,
            movement_type,
            quantity,
            reason,
        },
    )
    .await?;
    tx.commit().await?;
    get_lot(pool, &input.lot_id).await
}

pub(crate) async fn add_stock(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    lot_id: &str,
    single_use: bool,
    quantity: i64,
) -> Result<(), LotError> {
    if single_use {
        stock::apply_movement(
            tx,
            MovementDraft {
                lot_id: lot_id.to_string(),
                unit_id: None,
                session_id: None,
                movement_type: MovementType::Purchase,
                quantity,
                reason: None,
            },
        )
        .await?;
        return Ok(());
    }

    super::audit::record_units_received(tx, lot_id, quantity).await?;
    for _ in 0..quantity {
        let sql = format!(
            "INSERT INTO units (id, lot_id, opened_at, created_at, updated_at)
             VALUES (lower(hex(randomblob(16))), ?, NULL, {NOW}, {NOW})
             RETURNING id"
        );
        let unit_id: String = sqlx::query_scalar(&sql)
            .bind(lot_id)
            .fetch_one(&mut **tx)
            .await?;
        stock::apply_movement(
            tx,
            MovementDraft {
                lot_id: lot_id.to_string(),
                unit_id: Some(unit_id),
                session_id: None,
                movement_type: MovementType::Purchase,
                quantity: 1,
                reason: None,
            },
        )
        .await?;
    }
    Ok(())
}

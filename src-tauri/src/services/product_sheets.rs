//! Fiches produit : ce que l'atelier achète et réachète (« Dynamic Triple Black »).
//!
//! Une fiche porte le nom, la marque, la catégorie, le type (usage unique ou
//! multiple), la durée après ouverture et le lien du produit. Les lots (numéro,
//! péremption, pièces) y sont rattachés.
//!
//! Règles :
//! - identité : nom + marque, sans tenir compte de la casse ;
//! - un lot rattaché a le même type que sa fiche ; le type d'une fiche qui a des
//!   lots ne change plus ;
//! - rattacher un lot ne touche pas à son identité tracée (nom, numéro, péremption) ;
//! - la catégorie d'un lot rattaché suit celle de sa fiche ;
//! - type, durée après ouverture et lien servent de modèle aux nouveaux lots ; les
//!   lots déjà reçus gardent leurs valeurs ;
//! - une fiche qui a encore des lots ne se supprime pas.
//!
//! Les lots créés avant les fiches (migration 013) restent sans fiche jusqu'à ce
//! qu'on la crée ou la choisisse.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};

use super::archive::SHEET_LOCKED;
use super::categories;
use super::error::LotError;
use super::lots::{self, LotSummary};
use super::low_stock;
use super::sql::{self, NOW};

pub const SHEET_TAKEN: &str = "Une fiche produit porte déjà ce nom et cette marque";
pub const TYPE_MISMATCH: &str =
    "Ce lot et cette fiche produit n'ont pas le même type (usage unique ou multiple)";
pub const TYPE_LOCKED: &str =
    "Cette fiche a déjà des lots : son type (usage unique ou multiple) ne peut plus changer";
pub const SHEET_HAS_LOTS: &str =
    "Cette fiche a encore des lots : elle ne peut pas être supprimée. Archive-la pour la retirer des listes.";
pub const SHEET_GONE: &str = "Cette fiche produit n'existe plus";

const MAX_NAME_CHARS: usize = 120;

/// Nom donné aux lots reçus avec cette fiche : « Dynamic Triple Black ».
pub fn display_name(name: &str, brand: Option<&str>) -> String {
    match brand {
        Some(brand) => format!("{brand} {name}"),
        None => name.to_string(),
    }
}

/// Ce que la fiche impose à un lot (création, rattachement).
#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct Template {
    pub id: String,
    pub name: String,
    pub brand: Option<String>,
    pub single_use: bool,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    pub category_id: Option<String>,
}

impl Template {
    pub fn lot_name(&self) -> String {
        display_name(&self.name, self.brand.as_deref())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSheetInput {
    pub name: String,
    pub brand: Option<String>,
    pub category_id: Option<String>,
    pub single_use: bool,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    /// Stock bas : vide = seuil de la catégorie, 0 = pas d'alerte, N = alerte à N ou moins.
    #[serde(default)]
    pub low_stock_threshold: Option<i64>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProductSheetView {
    pub id: String,
    pub name: String,
    pub brand: Option<String>,
    /// « Dynamic Triple Black ».
    #[sqlx(skip)]
    pub display_name: String,
    pub category_id: Option<String>,
    #[sqlx(skip)]
    pub category_path: Option<String>,
    pub single_use: bool,
    pub after_opening_months: Option<i64>,
    pub product_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[sqlx(skip)]
    pub lot_count: i64,
    /// Stock utilisable : lots non périmés (pièces en stock pour l'usage multiple).
    #[sqlx(skip)]
    pub stock: i64,
    /// Stock encore présent dans des lots périmés.
    #[sqlx(skip)]
    pub expired_stock: i64,
    /// Seuil réglé sur la fiche (vide : celui de la catégorie ; 0 : pas d'alerte).
    pub low_stock_threshold: Option<i64>,
    pub archived_at: Option<String>,
    /// Seuil qui s'applique, d'où qu'il vienne ; `None` : pas d'alerte.
    #[sqlx(skip)]
    pub alert_threshold: Option<i64>,
    /// Catégorie d'où vient le seuil appliqué ; `None` s'il est réglé sur la fiche.
    #[sqlx(skip)]
    pub alert_source: Option<String>,
    /// Stock utilisable inférieur ou égal au seuil appliqué.
    #[sqlx(skip)]
    pub low_stock: bool,
}

struct Normalized {
    name: String,
    brand: Option<String>,
    after_opening_months: Option<i64>,
    product_url: Option<String>,
    low_stock_threshold: Option<i64>,
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize(input: &ProductSheetInput) -> Result<Normalized, LotError> {
    let name = collapse(&input.name);
    if name.is_empty() {
        return Err(LotError::Invalid("Le nom du produit est obligatoire"));
    }
    let brand = input
        .brand
        .as_deref()
        .map(collapse)
        .filter(|brand| !brand.is_empty());
    if name.chars().count() > MAX_NAME_CHARS
        || brand
            .as_ref()
            .is_some_and(|brand| brand.chars().count() > MAX_NAME_CHARS)
    {
        return Err(LotError::Invalid("Le nom ou la marque est trop long"));
    }
    let after_opening_months = match (input.single_use, input.after_opening_months) {
        (true, Some(_)) => {
            return Err(LotError::Invalid(
                "Un usage unique n'a pas de durée après ouverture",
            ))
        }
        (false, Some(months)) if months <= 0 => {
            return Err(LotError::Invalid(
                "La durée après ouverture doit être un nombre de mois positif",
            ))
        }
        (_, months) => months,
    };
    Ok(Normalized {
        name,
        brand,
        after_opening_months,
        product_url: sql::clean(input.product_url.clone()),
        low_stock_threshold: low_stock::check_sheet_threshold(input.low_stock_threshold)?,
    })
}

pub(crate) async fn template(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<Template, LotError> {
    sqlx::query_as::<_, Template>(
        "SELECT id, name, brand, single_use, after_opening_months, product_url, category_id
         FROM product_sheets WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(LotError::Invalid(SHEET_GONE))
}

async fn ensure_identity_free(
    tx: &mut Transaction<'_, Sqlite>,
    name: &str,
    brand: Option<&str>,
    except_id: Option<&str>,
) -> Result<(), LotError> {
    let taken: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM product_sheets
         WHERE name = ?1 COLLATE NOCASE
           AND COALESCE(brand, '') = COALESCE(?2, '') COLLATE NOCASE
           AND id != COALESCE(?3, '')
         LIMIT 1",
    )
    .bind(name)
    .bind(brand)
    .bind(except_id)
    .fetch_optional(&mut **tx)
    .await?;
    match taken {
        Some(_) => Err(LotError::Invalid(SHEET_TAKEN)),
        None => Ok(()),
    }
}

/// Range les lots de la fiche dans sa catégorie (la catégorie n'est pas une
/// donnée d'identité du lot : `updated_at` ne bouge pas).
async fn sync_lot_categories(
    tx: &mut Transaction<'_, Sqlite>,
    sheet_id: &str,
) -> Result<(), LotError> {
    sqlx::query(
        "UPDATE lots
         SET category_id = (SELECT category_id FROM product_sheets WHERE id = ?1)
         WHERE product_id = ?1
           AND archived_at IS NULL
           AND category_id IS NOT (SELECT category_id FROM product_sheets WHERE id = ?1)",
    )
    .bind(sheet_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Rattache un lot à une fiche, sans toucher à son identité.
pub(crate) async fn attach(
    tx: &mut Transaction<'_, Sqlite>,
    lot_id: &str,
    sheet_id: &str,
) -> Result<(), LotError> {
    let sheet = template(tx, sheet_id).await?;
    let archived: Option<String> =
        sqlx::query_scalar("SELECT archived_at FROM product_sheets WHERE id = ?")
            .bind(sheet_id)
            .fetch_one(&mut **tx)
            .await?;
    if archived.is_some() {
        return Err(LotError::Invalid(SHEET_LOCKED));
    }
    let lot_single_use: Option<bool> =
        sqlx::query_scalar("SELECT single_use FROM lots WHERE id = ?")
            .bind(lot_id)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(lot_single_use) = lot_single_use else {
        return Err(LotError::NotFound);
    };
    if lot_single_use != sheet.single_use {
        return Err(LotError::Invalid(TYPE_MISMATCH));
    }
    sqlx::query("UPDATE lots SET product_id = ?, category_id = ? WHERE id = ?")
        .bind(&sheet.id)
        .bind(&sheet.category_id)
        .bind(lot_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn lot_count(tx: &mut Transaction<'_, Sqlite>, sheet_id: &str) -> Result<i64, LotError> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM lots WHERE product_id = ?")
            .bind(sheet_id)
            .fetch_one(&mut **tx)
            .await?,
    )
}

const SHEET_SELECT: &str = "SELECT id, name, brand, category_id, single_use, after_opening_months,
        product_url, low_stock_threshold, archived_at, created_at, updated_at
    FROM product_sheets p";

/// Complète les fiches : nom affiché, chemin de catégorie, lots et stock.
async fn complete(
    pool: &SqlitePool,
    sheets: Vec<ProductSheetView>,
) -> Result<Vec<ProductSheetView>, LotError> {
    let categories: HashMap<String, categories::CategoryView> = categories::list_categories(pool)
        .await?
        .into_iter()
        .map(|category| (category.id.clone(), category))
        .collect();
    let mut by_sheet: HashMap<String, Vec<LotSummary>> = HashMap::new();
    for lot in lots::list_lots(pool, None, None).await? {
        if let Some(sheet_id) = lot.product_id.clone() {
            by_sheet.entry(sheet_id).or_default().push(lot);
        }
    }
    Ok(sheets
        .into_iter()
        .map(|mut sheet| {
            sheet.display_name = display_name(&sheet.name, sheet.brand.as_deref());
            sheet.category_path = sheet
                .category_id
                .as_ref()
                .and_then(|id| categories.get(id))
                .map(|category| category.path.clone());
            let lots = by_sheet.get(&sheet.id).map(Vec::as_slice).unwrap_or(&[]);
            let active: Vec<_> = lots
                .iter()
                .filter(|lot| lot.archived_at.is_none())
                .collect();
            sheet.lot_count = lots.len() as i64;
            sheet.stock = active
                .iter()
                .filter(|lot| !lot.expired)
                .map(|lot| lot.stock)
                .sum();
            sheet.expired_stock = active
                .iter()
                .filter(|lot| lot.expired)
                .map(|lot| lot.stock)
                .sum();
            let applied = low_stock::applied(
                sheet.low_stock_threshold,
                sheet.category_id.as_deref(),
                &categories,
            );
            sheet.low_stock = !active.is_empty()
                && applied
                    .as_ref()
                    .is_some_and(|applied| low_stock::is_low(sheet.stock, applied.threshold));
            sheet.alert_threshold = applied.as_ref().map(|applied| applied.threshold);
            sheet.alert_source = applied.and_then(|applied| applied.source);
            sheet
        })
        .collect())
}

/// Fiches triées par marque puis nom. La recherche porte sur le nom, la marque
/// et les numéros de lot.
pub async fn list_sheets(
    pool: &SqlitePool,
    search: Option<String>,
    archived: Option<bool>,
) -> Result<Vec<ProductSheetView>, LotError> {
    let pattern = sql::like_pattern(search);
    let sheets = sqlx::query_as::<_, ProductSheetView>(&format!(
        "{SHEET_SELECT}
         WHERE (?2 IS NULL OR (p.archived_at IS NOT NULL) = ?2)
           AND (?1 IS NULL
            OR p.name LIKE ?1 ESCAPE '\\'
            OR p.brand LIKE ?1 ESCAPE '\\'
            OR EXISTS (
                SELECT 1 FROM lots l
                WHERE l.product_id = p.id
                  AND (l.lot_number LIKE ?1 ESCAPE '\\' OR l.name LIKE ?1 ESCAPE '\\')
            ))
         ORDER BY COALESCE(p.brand, '') COLLATE NOCASE, p.name COLLATE NOCASE"
    ))
    .bind(pattern)
    .bind(archived)
    .fetch_all(pool)
    .await?;
    complete(pool, sheets).await
}

pub async fn get_sheet(pool: &SqlitePool, id: &str) -> Result<ProductSheetView, LotError> {
    let sheet = sqlx::query_as::<_, ProductSheetView>(&format!("{SHEET_SELECT} WHERE p.id = ?"))
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(LotError::Invalid(SHEET_GONE))?;
    Ok(complete(pool, vec![sheet]).await?.remove(0))
}

/// Crée une fiche et y rattache, dans la même transaction, les lots choisis
/// (par exemple les lots existants du même nom).
pub async fn create_sheet(
    pool: &SqlitePool,
    input: ProductSheetInput,
    attach_lot_ids: Vec<String>,
) -> Result<ProductSheetView, LotError> {
    let normalized = normalize(&input)?;
    let mut tx = pool.begin().await?;
    let category_id = categories::check_lot_category(&mut tx, input.category_id).await?;
    ensure_identity_free(&mut tx, &normalized.name, normalized.brand.as_deref(), None).await?;
    let id: String = sqlx::query_scalar(&format!(
        "INSERT INTO product_sheets
            (id, name, brand, category_id, single_use, after_opening_months, product_url,
             low_stock_threshold, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, {NOW}, {NOW})
         RETURNING id"
    ))
    .bind(&normalized.name)
    .bind(&normalized.brand)
    .bind(&category_id)
    .bind(input.single_use)
    .bind(normalized.after_opening_months)
    .bind(&normalized.product_url)
    .bind(normalized.low_stock_threshold)
    .fetch_one(&mut *tx)
    .await?;
    for lot_id in &attach_lot_ids {
        attach(&mut tx, lot_id, &id).await?;
    }
    tx.commit().await?;
    get_sheet(pool, &id).await
}

pub async fn update_sheet(
    pool: &SqlitePool,
    id: &str,
    input: ProductSheetInput,
) -> Result<ProductSheetView, LotError> {
    let normalized = normalize(&input)?;
    let mut tx = pool.begin().await?;
    let current = template(&mut tx, id).await?;
    let archived: Option<String> =
        sqlx::query_scalar("SELECT archived_at FROM product_sheets WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if archived.is_some() {
        return Err(LotError::Invalid(SHEET_LOCKED));
    }
    if current.single_use != input.single_use && lot_count(&mut tx, id).await? > 0 {
        return Err(LotError::Invalid(TYPE_LOCKED));
    }
    let category_id = categories::check_lot_category(&mut tx, input.category_id).await?;
    ensure_identity_free(
        &mut tx,
        &normalized.name,
        normalized.brand.as_deref(),
        Some(id),
    )
    .await?;
    sqlx::query(&format!(
        "UPDATE product_sheets
         SET name = ?, brand = ?, category_id = ?, single_use = ?, after_opening_months = ?,
             product_url = ?, low_stock_threshold = ?, updated_at = {NOW}
         WHERE id = ?"
    ))
    .bind(&normalized.name)
    .bind(&normalized.brand)
    .bind(&category_id)
    .bind(input.single_use)
    .bind(normalized.after_opening_months)
    .bind(&normalized.product_url)
    .bind(normalized.low_stock_threshold)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    sync_lot_categories(&mut tx, id).await?;
    tx.commit().await?;
    get_sheet(pool, id).await
}

pub async fn delete_sheet(pool: &SqlitePool, id: &str) -> Result<(), LotError> {
    let mut tx = pool.begin().await?;
    template(&mut tx, id).await?;
    if lot_count(&mut tx, id).await? > 0 {
        return Err(LotError::Invalid(SHEET_HAS_LOTS));
    }
    sqlx::query("DELETE FROM product_sheets WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetRemoval {
    pub sheet_id: String,
    pub archived: bool,
    pub can_delete: bool,
    pub lot_count: i64,
}

pub async fn removal_preview(pool: &SqlitePool, id: &str) -> Result<SheetRemoval, LotError> {
    let sheet = get_sheet(pool, id).await?;
    Ok(SheetRemoval {
        sheet_id: sheet.id,
        archived: sheet.archived_at.is_some(),
        can_delete: sheet.lot_count == 0 && sheet.archived_at.is_none(),
        lot_count: sheet.lot_count,
    })
}

pub async fn archive_sheet(pool: &SqlitePool, id: &str) -> Result<(), LotError> {
    let mut tx = pool.begin().await?;
    let state: Option<(Option<String>, i64)> = sqlx::query_as(
        "SELECT archived_at, (SELECT COUNT(*) FROM lots WHERE product_id = product_sheets.id)
         FROM product_sheets WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((archived_at, lots)) = state else {
        return Err(LotError::Invalid(SHEET_GONE));
    };
    if archived_at.is_some() {
        return Err(LotError::Invalid("Cette fiche est déjà archivée"));
    }
    if lots == 0 {
        return Err(LotError::Invalid(
            "Rien n'est relié à cette fiche : supprime-la.",
        ));
    }
    sqlx::query(&format!(
        "UPDATE product_sheets SET archived_at = {NOW}, updated_at = {NOW} WHERE id = ?"
    ))
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn restore_sheet(pool: &SqlitePool, id: &str) -> Result<(), LotError> {
    let archived_at: Option<Option<String>> =
        sqlx::query_scalar("SELECT archived_at FROM product_sheets WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(archived_at) = archived_at else {
        return Err(LotError::Invalid(SHEET_GONE));
    };
    if archived_at.is_none() {
        return Err(LotError::Invalid("Cette fiche n'est pas archivée"));
    }
    sqlx::query(&format!(
        "UPDATE product_sheets SET archived_at = NULL, updated_at = {NOW} WHERE id = ?"
    ))
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Rattache un lot à une fiche, ou le détache (`None`). Son identité ne change pas ;
/// détaché, il garde la catégorie qu'il avait.
pub async fn set_lot_sheet(
    pool: &SqlitePool,
    lot_id: &str,
    sheet_id: Option<String>,
) -> Result<LotSummary, LotError> {
    let mut tx = pool.begin().await?;
    match sql::clean(sheet_id) {
        Some(sheet_id) => attach(&mut tx, lot_id, &sheet_id).await?,
        None => {
            let done = sqlx::query("UPDATE lots SET product_id = NULL WHERE id = ?")
                .bind(lot_id)
                .execute(&mut *tx)
                .await?;
            if done.rows_affected() == 0 {
                return Err(LotError::NotFound);
            }
        }
    }
    tx.commit().await?;
    lots::get_lot(pool, lot_id).await
}

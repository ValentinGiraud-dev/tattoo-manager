//! Stock bas (migration 014).
//!
//! - Stock surveillé d'une fiche produit : somme de ses lots non périmés (pièces
//!   en stock pour l'usage multiple). Les lots sans fiche ne sont pas surveillés.
//! - Alerte quand ce stock est inférieur ou égal au seuil.
//! - Seuil d'une fiche : le sien s'il est réglé (0 = pas d'alerte), sinon celui de
//!   la catégorie la plus proche réglée « chaque produit » (`EACH`), en remontant
//!   les catégories parentes.
//! - Une catégorie réglée « au total » (`TOTAL`) alerte sur la somme du stock des
//!   fiches de sa branche (produits interchangeables).

use std::collections::HashMap;

use serde::Serialize;
use sqlx::SqlitePool;

use super::categories::{self, CategoryView};
use super::error::LotError;
use super::product_sheets;

pub const EACH: &str = "EACH";
pub const TOTAL: &str = "TOTAL";
pub const MAX_THRESHOLD: i64 = 100_000;
pub const THRESHOLD_INVALID: &str = "Le seuil d'alerte doit être un nombre entier positif";
/// Garde-fou contre une boucle de catégories (impossible en principe).
const MAX_DEPTH: usize = 50;

/// Seuil qui s'applique à une fiche.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub threshold: i64,
    /// Chemin de la catégorie dont il vient ; `None` s'il est réglé sur la fiche.
    pub source: Option<String>,
}

pub fn is_low(stock: i64, threshold: i64) -> bool {
    stock <= threshold
}

/// Vérifie un seuil saisi sur une fiche (`None` : celui de la catégorie, 0 : aucun).
pub fn check_sheet_threshold(threshold: Option<i64>) -> Result<Option<i64>, LotError> {
    match threshold {
        Some(value) if !(0..=MAX_THRESHOLD).contains(&value) => {
            Err(LotError::Invalid(THRESHOLD_INVALID))
        }
        other => Ok(other),
    }
}

/// Seuil d'une fiche, d'après le sien et ses catégories.
pub fn applied(
    own: Option<i64>,
    category_id: Option<&str>,
    categories: &HashMap<String, CategoryView>,
) -> Option<Applied> {
    match own {
        Some(0) => None,
        Some(threshold) => Some(Applied {
            threshold,
            source: None,
        }),
        None => {
            let mut current = category_id;
            for _ in 0..MAX_DEPTH {
                let category = categories.get(current?)?;
                if let (Some(EACH), Some(threshold)) = (
                    category.low_stock_mode.as_deref(),
                    category.low_stock_threshold,
                ) {
                    return Some(Applied {
                        threshold,
                        source: Some(category.path.clone()),
                    });
                }
                current = category.parent_id.as_deref();
            }
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetAlert {
    pub sheet_id: String,
    pub display_name: String,
    pub single_use: bool,
    pub stock: i64,
    pub threshold: i64,
    /// Catégorie d'où vient le seuil, `None` s'il est réglé sur la fiche.
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryAlert {
    pub category_id: String,
    pub path: String,
    /// Somme du stock des fiches de la branche.
    pub stock: i64,
    pub threshold: i64,
    pub sheet_count: i64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LowStockReport {
    pub sheets: Vec<SheetAlert>,
    pub categories: Vec<CategoryAlert>,
}

/// Fiches et catégories en stock bas, du stock le plus faible au plus fort.
pub async fn report(pool: &SqlitePool) -> Result<LowStockReport, LotError> {
    let sheets = product_sheets::list_sheets(pool, None).await?;
    let categories = categories::list_categories(pool).await?;

    let mut sheet_alerts: Vec<SheetAlert> = sheets
        .iter()
        .filter(|sheet| sheet.low_stock)
        .filter_map(|sheet| {
            Some(SheetAlert {
                sheet_id: sheet.id.clone(),
                display_name: sheet.display_name.clone(),
                single_use: sheet.single_use,
                stock: sheet.stock,
                threshold: sheet.alert_threshold?,
                source: sheet.alert_source.clone(),
            })
        })
        .collect();
    sheet_alerts.sort_by(|a, b| {
        a.stock.cmp(&b.stock).then_with(|| {
            a.display_name
                .to_lowercase()
                .cmp(&b.display_name.to_lowercase())
        })
    });

    // Chaque fiche compte dans sa catégorie et dans toutes les catégories au-dessus.
    let parents: HashMap<&str, Option<&str>> = categories
        .iter()
        .map(|category| (category.id.as_str(), category.parent_id.as_deref()))
        .collect();
    let mut totals: HashMap<&str, (i64, i64)> = HashMap::new();
    for sheet in &sheets {
        let mut current = sheet.category_id.as_deref();
        for _ in 0..MAX_DEPTH {
            let Some(id) = current else { break };
            let entry = totals.entry(id).or_default();
            entry.0 += sheet.stock;
            entry.1 += 1;
            current = parents.get(id).copied().flatten();
        }
    }
    let category_alerts = categories
        .iter()
        .filter_map(|category| {
            if category.low_stock_mode.as_deref() != Some(TOTAL) {
                return None;
            }
            let threshold = category.low_stock_threshold?;
            let (stock, sheet_count) = totals
                .get(category.id.as_str())
                .copied()
                .unwrap_or_default();
            is_low(stock, threshold).then(|| CategoryAlert {
                category_id: category.id.clone(),
                path: category.path.clone(),
                stock,
                threshold,
                sheet_count,
            })
        })
        .collect();

    Ok(LowStockReport {
        sheets: sheet_alerts,
        categories: category_alerts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn category(id: &str, parent: Option<&str>, setting: Option<(&str, i64)>) -> CategoryView {
        CategoryView {
            id: id.into(),
            parent_id: parent.map(Into::into),
            name: id.into(),
            depth: 0,
            path: format!("chemin {id}"),
            lot_count: 0,
            total_lot_count: 0,
            child_count: 0,
            low_stock_threshold: setting.map(|(_, threshold)| threshold),
            low_stock_mode: setting.map(|(mode, _)| mode.to_string()),
        }
    }

    fn tree() -> HashMap<String, CategoryView> {
        [
            category("encres", None, Some((EACH, 2))),
            category("noires", Some("encres"), Some((TOTAL, 5))),
            category("dynamic", Some("noires"), None),
            category("aiguilles", None, None),
        ]
        .into_iter()
        .map(|category| (category.id.clone(), category))
        .collect()
    }

    #[test]
    fn the_nearest_per_product_category_threshold_applies() {
        let categories = tree();
        // « Noires » est réglée au total : on remonte jusqu'à « Encres ».
        assert_eq!(
            applied(None, Some("dynamic"), &categories),
            Some(Applied {
                threshold: 2,
                source: Some("chemin encres".into())
            })
        );
        assert_eq!(applied(None, Some("aiguilles"), &categories), None);
        assert_eq!(applied(None, None, &categories), None);
    }

    #[test]
    fn a_sheet_threshold_wins_and_zero_disables_the_alert() {
        let categories = tree();
        assert_eq!(
            applied(Some(4), Some("encres"), &categories),
            Some(Applied {
                threshold: 4,
                source: None
            })
        );
        assert_eq!(applied(Some(0), Some("encres"), &categories), None);
    }

    #[test]
    fn low_means_at_or_below_the_threshold() {
        assert!(is_low(2, 2));
        assert!(is_low(0, 1));
        assert!(!is_low(3, 2));
        assert!(check_sheet_threshold(Some(-1)).is_err());
        assert!(check_sheet_threshold(Some(MAX_THRESHOLD + 1)).is_err());
        assert_eq!(check_sheet_threshold(Some(0)).unwrap(), Some(0));
    }
}

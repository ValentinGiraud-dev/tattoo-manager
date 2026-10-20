//! Catégories de produits : un arbre libre (« Encres », « Aiguilles › RL »…).
//!
//! Une catégorie range des lots ; elle ne touche ni au stock ni à la traçabilité.
//! Règles :
//! - nom obligatoire, unique parmi ses sœurs (sans tenir compte de la casse) ;
//! - autant de niveaux que voulu, mais jamais de boucle (une catégorie ne peut pas
//!   être rangée dans elle-même ni dans une de ses sous-catégories) ;
//! - supprimer une catégorie ne supprime rien d'autre : ses sous-catégories et ses
//!   produits remontent d'un niveau.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};

use super::error::LotError;
use super::sql::NOW;

/// Longueur maximale d'un nom de catégorie.
const MAX_NAME_CHARS: usize = 60;
/// Garde-fou contre une profondeur absurde (et une boucle en base, impossible en principe).
const MAX_DEPTH: usize = 20;
/// Séparateur affiché entre les niveaux : « Aiguilles › RL ».
pub const PATH_SEPARATOR: &str = " › ";

pub const SIBLING_NAME_TAKEN: &str = "Une catégorie porte déjà ce nom à cet endroit";
pub const CATEGORY_LOOP: &str =
    "Une catégorie ne peut pas être rangée dans elle-même ni dans une de ses sous-catégories";

#[derive(Debug, Clone, sqlx::FromRow)]
struct CategoryRow {
    id: String,
    parent_id: Option<String>,
    name: String,
    lot_count: i64,
    low_stock_threshold: Option<i64>,
    low_stock_mode: Option<String>,
}

/// Une catégorie, dans l'ordre de l'arbre (parent puis enfants, sœurs par nom).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryView {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    /// 0 pour une catégorie racine.
    pub depth: usize,
    /// Chemin complet : « Aiguilles › RL ».
    pub path: String,
    /// Produits rangés directement ici : fiches produit et lots sans fiche.
    pub lot_count: i64,
    /// Produits rangés ici ou dans une sous-catégorie.
    pub total_lot_count: i64,
    pub child_count: usize,
    /// Seuil de stock bas (voir `low_stock_mode`), `None` sans alerte.
    pub low_stock_threshold: Option<i64>,
    /// `EACH` : seuil de chaque fiche de la branche ; `TOTAL` : seuil de leur somme.
    pub low_stock_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub name: String,
    pub parent_id: Option<String>,
}

fn normalize_name(name: &str) -> Result<String, LotError> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(LotError::Invalid("Le nom de la catégorie est obligatoire"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(LotError::Invalid(
            "Le nom de la catégorie est trop long (60 caractères au plus)",
        ));
    }
    if name.contains('›') {
        return Err(LotError::Invalid(
            "Le caractère « › » est réservé à l'affichage du chemin",
        ));
    }
    Ok(name)
}

fn normalize_parent(parent_id: Option<String>) -> Option<String> {
    parent_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

async fn rows(pool: &SqlitePool) -> Result<Vec<CategoryRow>, LotError> {
    Ok(sqlx::query_as::<_, CategoryRow>(
        "SELECT c.id, c.parent_id, c.name, c.low_stock_threshold, c.low_stock_mode,
                (SELECT COUNT(*) FROM product_sheets p WHERE p.category_id = c.id)
                + (SELECT COUNT(*) FROM lots l
                   WHERE l.category_id = c.id AND l.product_id IS NULL) AS lot_count
         FROM product_categories c",
    )
    .fetch_all(pool)
    .await?)
}

/// Construit l'arbre à plat, dans l'ordre d'affichage.
fn build_tree(rows: Vec<CategoryRow>) -> Vec<CategoryView> {
    let mut children: HashMap<Option<String>, Vec<CategoryRow>> = HashMap::new();
    for row in rows {
        children.entry(row.parent_id.clone()).or_default().push(row);
    }
    for siblings in children.values_mut() {
        siblings.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.id.cmp(&b.id))
        });
    }

    fn visit(
        parent: Option<String>,
        depth: usize,
        prefix: &str,
        children: &HashMap<Option<String>, Vec<CategoryRow>>,
        out: &mut Vec<CategoryView>,
    ) -> i64 {
        let mut subtotal = 0;
        if depth > MAX_DEPTH {
            return 0;
        }
        for row in children.get(&parent).map(Vec::as_slice).unwrap_or_default() {
            let path = if prefix.is_empty() {
                row.name.clone()
            } else {
                format!("{prefix}{PATH_SEPARATOR}{}", row.name)
            };
            let index = out.len();
            out.push(CategoryView {
                id: row.id.clone(),
                parent_id: row.parent_id.clone(),
                name: row.name.clone(),
                depth,
                path: path.clone(),
                lot_count: row.lot_count,
                total_lot_count: 0,
                child_count: children.get(&Some(row.id.clone())).map_or(0, Vec::len),
                low_stock_threshold: row.low_stock_threshold,
                low_stock_mode: row.low_stock_mode.clone(),
            });
            let below = visit(Some(row.id.clone()), depth + 1, &path, children, out);
            let total = row.lot_count + below;
            out[index].total_lot_count = total;
            subtotal += total;
        }
        subtotal
    }

    let mut out = Vec::new();
    visit(None, 0, "", &children, &mut out);
    out
}

pub async fn list_categories(pool: &SqlitePool) -> Result<Vec<CategoryView>, LotError> {
    Ok(build_tree(rows(pool).await?))
}

/// Chemins de toutes les catégories (« Aiguilles › RL »), pour l'affichage des lots.
pub async fn category_paths(pool: &SqlitePool) -> Result<HashMap<String, String>, LotError> {
    Ok(list_categories(pool)
        .await?
        .into_iter()
        .map(|category| (category.id, category.path))
        .collect())
}

pub async fn get_category(pool: &SqlitePool, id: &str) -> Result<CategoryView, LotError> {
    list_categories(pool)
        .await?
        .into_iter()
        .find(|category| category.id == id)
        .ok_or(LotError::Invalid("Cette catégorie n'existe plus"))
}

async fn ensure_exists(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<(), LotError> {
    let found: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM product_categories WHERE id = ? LIMIT 1")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;
    found
        .map(|_| ())
        .ok_or(LotError::Invalid("Cette catégorie n'existe plus"))
}

/// Vérifie qu'aucune autre catégorie sœur ne porte ce nom.
async fn ensure_name_free(
    tx: &mut Transaction<'_, Sqlite>,
    parent_id: Option<&str>,
    name: &str,
    except_id: Option<&str>,
) -> Result<(), LotError> {
    let taken: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM product_categories
         WHERE COALESCE(parent_id, '') = COALESCE(?1, '')
           AND name = ?2 COLLATE NOCASE
           AND id != COALESCE(?3, '')
         LIMIT 1",
    )
    .bind(parent_id)
    .bind(name)
    .bind(except_id)
    .fetch_optional(&mut **tx)
    .await?;
    if taken.is_some() {
        return Err(LotError::Invalid(SIBLING_NAME_TAKEN));
    }
    Ok(())
}

/// Vrai si `candidate` est `id` ou une de ses sous-catégories.
async fn is_self_or_descendant(
    tx: &mut Transaction<'_, Sqlite>,
    id: &str,
    candidate: &str,
) -> Result<bool, LotError> {
    let found: Option<i64> = sqlx::query_scalar(
        "WITH RECURSIVE below(id, depth) AS (
             SELECT ?1, 0
             UNION ALL
             SELECT c.id, below.depth + 1
             FROM product_categories c
             INNER JOIN below ON c.parent_id = below.id
             WHERE below.depth < 50
         )
         SELECT 1 FROM below WHERE id = ?2 LIMIT 1",
    )
    .bind(id)
    .bind(candidate)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(found.is_some())
}

pub async fn create_category(
    pool: &SqlitePool,
    input: CategoryInput,
) -> Result<CategoryView, LotError> {
    let name = normalize_name(&input.name)?;
    let parent_id = normalize_parent(input.parent_id);
    let mut tx = pool.begin().await?;
    if let Some(parent) = &parent_id {
        ensure_exists(&mut tx, parent).await?;
    }
    ensure_name_free(&mut tx, parent_id.as_deref(), &name, None).await?;
    let sql = format!(
        "INSERT INTO product_categories (id, parent_id, name, created_at, updated_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, {NOW}, {NOW})
         RETURNING id"
    );
    let id: String = sqlx::query_scalar(&sql)
        .bind(&parent_id)
        .bind(&name)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    get_category(pool, &id).await
}

/// Renomme et/ou déplace une catégorie (avec tout son contenu).
pub async fn update_category(
    pool: &SqlitePool,
    id: &str,
    input: CategoryInput,
) -> Result<CategoryView, LotError> {
    let name = normalize_name(&input.name)?;
    let parent_id = normalize_parent(input.parent_id);
    let mut tx = pool.begin().await?;
    ensure_exists(&mut tx, id).await?;
    if let Some(parent) = &parent_id {
        ensure_exists(&mut tx, parent).await?;
        if is_self_or_descendant(&mut tx, id, parent).await? {
            return Err(LotError::Invalid(CATEGORY_LOOP));
        }
    }
    ensure_name_free(&mut tx, parent_id.as_deref(), &name, Some(id)).await?;
    let sql = format!(
        "UPDATE product_categories SET name = ?, parent_id = ?, updated_at = {NOW} WHERE id = ?"
    );
    sqlx::query(&sql)
        .bind(&name)
        .bind(&parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    get_category(pool, id).await
}

/// Supprime une catégorie. Ses sous-catégories et ses lots remontent dans la
/// catégorie parente (ou à la racine / « sans catégorie »). Rien d'autre ne change.
pub async fn delete_category(pool: &SqlitePool, id: &str) -> Result<(), LotError> {
    let mut tx = pool.begin().await?;
    let parent_id: Option<Option<String>> =
        sqlx::query_scalar("SELECT parent_id FROM product_categories WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(parent_id) = parent_id else {
        return Err(LotError::Invalid("Cette catégorie n'existe plus"));
    };

    // Une sous-catégorie qui remonte ne doit pas croiser une sœur du même nom.
    let clash: Option<String> = sqlx::query_scalar(
        "SELECT child.name
         FROM product_categories child
         INNER JOIN product_categories other
            ON COALESCE(other.parent_id, '') = COALESCE(?2, '')
           AND other.id != ?1
           AND other.name = child.name COLLATE NOCASE
         WHERE child.parent_id = ?1
         LIMIT 1",
    )
    .bind(id)
    .bind(&parent_id)
    .fetch_optional(&mut *tx)
    .await?;
    if clash.is_some() {
        return Err(LotError::Invalid(
            "Une sous-catégorie porte le même nom qu'une catégorie du niveau au-dessus : renommez-la avant de supprimer",
        ));
    }

    let sql = format!(
        "UPDATE product_categories SET parent_id = ?, updated_at = {NOW} WHERE parent_id = ?"
    );
    sqlx::query(&sql)
        .bind(&parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE product_sheets SET category_id = ? WHERE category_id = ?")
        .bind(&parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    // La catégorie n'est pas une donnée d'identité du lot : updated_at ne bouge pas.
    sqlx::query("UPDATE lots SET category_id = ? WHERE category_id = ?")
        .bind(&parent_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM product_categories WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Seuil de stock bas d'une catégorie. `mode` et `threshold` vides ensemble : pas d'alerte.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LowStockSetting {
    /// `EACH` (chaque produit) ou `TOTAL` (somme de la catégorie).
    pub mode: Option<String>,
    pub threshold: Option<i64>,
}

pub async fn set_low_stock(
    pool: &SqlitePool,
    id: &str,
    setting: LowStockSetting,
) -> Result<CategoryView, LotError> {
    let (mode, threshold) = match (setting.mode.as_deref().map(str::trim), setting.threshold) {
        (None | Some(""), _) => (None, None),
        (Some(mode @ ("EACH" | "TOTAL")), Some(threshold))
            if (1..=super::low_stock::MAX_THRESHOLD).contains(&threshold) =>
        {
            (Some(mode.to_string()), Some(threshold))
        }
        (Some("EACH" | "TOTAL"), _) => {
            return Err(LotError::Invalid(super::low_stock::THRESHOLD_INVALID))
        }
        (Some(_), _) => return Err(LotError::Invalid("Mode d'alerte inconnu")),
    };
    let mut tx = pool.begin().await?;
    ensure_exists(&mut tx, id).await?;
    sqlx::query(&format!(
        "UPDATE product_categories
         SET low_stock_mode = ?, low_stock_threshold = ?, updated_at = {NOW}
         WHERE id = ?"
    ))
    .bind(&mode)
    .bind(threshold)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    get_category(pool, id).await
}

/// Vérifie la catégorie choisie pour un lot (`None` : sans catégorie).
pub(crate) async fn check_lot_category(
    tx: &mut Transaction<'_, Sqlite>,
    category_id: Option<String>,
) -> Result<Option<String>, LotError> {
    let category_id = normalize_parent(category_id);
    if let Some(id) = &category_id {
        ensure_exists(tx, id).await?;
    }
    Ok(category_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, parent: Option<&str>, name: &str, lots: i64) -> CategoryRow {
        CategoryRow {
            id: id.into(),
            parent_id: parent.map(Into::into),
            name: name.into(),
            lot_count: lots,
            low_stock_threshold: None,
            low_stock_mode: None,
        }
    }

    #[test]
    fn the_tree_is_flattened_in_display_order_with_paths_and_totals() {
        let tree = build_tree(vec![
            row("rl", Some("aig"), "RL", 3),
            row("enc", None, "encres", 2),
            row("aig", None, "Aiguilles", 1),
            row("rs", Some("aig"), "RS", 0),
            row("rl3", Some("rl"), "3RL", 4),
        ]);
        let shown: Vec<_> = tree
            .iter()
            .map(|c| (c.path.as_str(), c.depth, c.total_lot_count))
            .collect();
        assert_eq!(
            shown,
            [
                ("Aiguilles", 0, 8),
                ("Aiguilles › RL", 1, 7),
                ("Aiguilles › RL › 3RL", 2, 4),
                ("Aiguilles › RS", 1, 0),
                ("encres", 0, 2),
            ]
        );
        assert_eq!(tree[0].child_count, 2);
    }

    #[test]
    fn names_are_tidied_and_checked() {
        assert_eq!(normalize_name("  Aiguilles   RL ").unwrap(), "Aiguilles RL");
        assert!(normalize_name("   ").is_err());
        assert!(normalize_name(&"x".repeat(61)).is_err());
        assert!(normalize_name("A › B").is_err());
    }
}

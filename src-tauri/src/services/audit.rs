//! Journal d'audit (table `audit_log`, migration 012).
//!
//! Les écritures en base sont journalisées par des déclencheurs SQLite, dans la
//! même transaction. Ce module lit le journal (écran « Journal », historique des
//! fiches) et écrit les entrées qui ne correspondent pas à une ligne de table :
//! sécurité, sauvegardes, exports, réception d'un usage multiple.
//!
//! Le journal ne se modifie pas et ne s'efface pas : aucune fonction ici ne le permet,
//! et les déclencheurs `audit_log_no_*` le refusent.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{Sqlite, SqlitePool, Transaction};

use super::categories;
use super::error::LotError;
use super::sql;

/// Entrées écrites par l'app elle-même (entity = `app`).
pub mod event {
    pub const SECURITY_ENABLED: &str = "SECURITY_ENABLED";
    pub const PASSWORD_CHANGED: &str = "PASSWORD_CHANGED";
    pub const RECOVERY_KEY_RENEWED: &str = "RECOVERY_KEY_RENEWED";
    pub const TOUCH_ID_CHANGED: &str = "TOUCH_ID_CHANGED";
    pub const AUTO_LOCK_CHANGED: &str = "AUTO_LOCK_CHANGED";
    pub const BACKUP_FOLDER_CHANGED: &str = "BACKUP_FOLDER_CHANGED";
    /// Ignorée par l'empreinte des sauvegardes : sinon chaque sauvegarde en
    /// déclencherait une autre le lendemain, sans aucun changement réel.
    pub const BACKUP_CREATED: &str = "BACKUP_CREATED";
    pub const BACKUP_RESTORED: &str = "BACKUP_RESTORED";
    pub const CSV_EXPORTED: &str = "CSV_EXPORTED";
    pub const KEY_ROTATED: &str = "KEY_ROTATED";
    /// Base locale remplacée par une base vide. Aucun nom dans le détail.
    pub const DATA_RESET: &str = "DATA_RESET";
}

/// Familles proposées dans le filtre de l'écran Journal.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuditGroup {
    Clients,
    Sessions,
    Billing,
    Stock,
    App,
}

impl AuditGroup {
    fn entities(self) -> &'static [&'static str] {
        match self {
            Self::Clients => &["client", "project"],
            Self::Sessions => &[
                "session",
                "session_form",
                "session_document",
                "session_usage",
                "session_usage_void",
            ],
            Self::Billing => &["deposit", "deposit_outcome", "payment"],
            Self::Stock => &["product", "lot", "unit", "stock_movement", "category"],
            Self::App => &["app"],
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuditQuery {
    /// Date locale `AAAA-MM-JJ` incluse.
    pub from: Option<String>,
    pub to: Option<String>,
    pub group: Option<AuditGroup>,
    pub client_id: Option<String>,
    pub session_id: Option<String>,
    pub lot_id: Option<String>,
    /// Pagination : entrées plus anciennes que ce numéro.
    pub before_seq: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditChange {
    pub field: String,
    pub before: Value,
    pub after: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub seq: i64,
    /// Horodatage UTC `AAAA-MM-JJTHH:MM:SS`.
    pub occurred_at: String,
    /// `CREATE`, `UPDATE`, `DELETE`, ou un code d'événement (`event::*`).
    pub action: String,
    pub entity: String,
    pub entity_id: Option<String>,
    pub label: Option<String>,
    pub client_id: Option<String>,
    pub session_id: Option<String>,
    pub lot_id: Option<String>,
    /// Champs créés, modifiés ou supprimés (valeurs brutes, mises en forme par l'écran).
    pub changes: Vec<AuditChange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    /// Noms actuels des fiches citées dans les changements (client, projet, séance,
    /// lot, catégorie), par identifiant. Un identifiant absent : fiche supprimée.
    pub names: BTreeMap<String, String>,
    pub has_more: bool,
}

#[derive(sqlx::FromRow)]
struct AuditRow {
    seq: i64,
    occurred_at: String,
    action: String,
    entity: String,
    entity_id: Option<String>,
    label: Option<String>,
    client_id: Option<String>,
    session_id: Option<String>,
    lot_id: Option<String>,
    before_json: Option<String>,
    after_json: Option<String>,
}

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 500;

/// Champs qui pointent vers une autre fiche : leur nom est joint à la page.
const REFERENCE_FIELDS: [&str; 8] = [
    "client_id",
    "project_id",
    "session_id",
    "lot_id",
    "category_id",
    "parent_id",
    "deposit_id",
    "product_id",
];

fn as_object(json: Option<&str>) -> Map<String, Value> {
    json.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

/// Ce qui a changé : tous les champs renseignés pour une création ou une
/// suppression, les champs différents pour une modification.
pub(crate) fn diff(before: Option<&str>, after: Option<&str>) -> Vec<AuditChange> {
    let before = as_object(before);
    let after = as_object(after);
    let mut fields: Vec<&String> = after.keys().collect();
    fields.extend(before.keys().filter(|key| !after.contains_key(*key)));
    fields
        .into_iter()
        .filter_map(|field| {
            let old = before.get(field).cloned().unwrap_or(Value::Null);
            let new = after.get(field).cloned().unwrap_or(Value::Null);
            (old != new).then(|| AuditChange {
                field: field.clone(),
                before: old,
                after: new,
            })
        })
        .collect()
}

fn check_date(value: Option<String>) -> Result<Option<String>, LotError> {
    match sql::clean(value) {
        Some(date) if !sql::is_iso_date(&date) => Err(LotError::Invalid("Période invalide")),
        other => Ok(other),
    }
}

pub async fn list_entries(pool: &SqlitePool, query: AuditQuery) -> Result<AuditPage, LotError> {
    let from = check_date(query.from)?;
    let to = check_date(query.to)?;
    if let (Some(from), Some(to)) = (&from, &to) {
        if from > to {
            return Err(LotError::Invalid(
                "La date de début doit précéder la date de fin",
            ));
        }
    }
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let entities = query
        .group
        .map(|group| serde_json::to_string(group.entities()).unwrap_or_default());

    let mut rows = sqlx::query_as::<_, AuditRow>(
        "SELECT seq, occurred_at, action, entity, entity_id, label,
                client_id, session_id, lot_id, before_json, after_json
         FROM audit_log
         WHERE (?1 IS NULL OR client_id = ?1)
           AND (?2 IS NULL OR session_id = ?2)
           AND (?3 IS NULL OR lot_id = ?3)
           AND (?4 IS NULL OR date(occurred_at, 'localtime') >= ?4)
           AND (?5 IS NULL OR date(occurred_at, 'localtime') <= ?5)
           AND (?6 IS NULL OR entity IN (SELECT value FROM json_each(?6)))
           AND (?7 IS NULL OR seq < ?7)
         ORDER BY seq DESC
         LIMIT ?8",
    )
    .bind(sql::clean(query.client_id))
    .bind(sql::clean(query.session_id))
    .bind(sql::clean(query.lot_id))
    .bind(from)
    .bind(to)
    .bind(entities)
    .bind(query.before_seq)
    .bind(limit + 1)
    .fetch_all(pool)
    .await?;

    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    let entries: Vec<AuditEntry> = rows
        .into_iter()
        .map(|row| AuditEntry {
            changes: diff(row.before_json.as_deref(), row.after_json.as_deref()),
            seq: row.seq,
            occurred_at: row.occurred_at,
            action: row.action,
            entity: row.entity,
            entity_id: row.entity_id,
            label: row.label,
            client_id: row.client_id,
            session_id: row.session_id,
            lot_id: row.lot_id,
        })
        .collect();
    let names = reference_names(pool, &entries).await?;
    Ok(AuditPage {
        entries,
        names,
        has_more,
    })
}

async fn reference_names(
    pool: &SqlitePool,
    entries: &[AuditEntry],
) -> Result<BTreeMap<String, String>, LotError> {
    let mut ids: Vec<&str> = entries
        .iter()
        .flat_map(|entry| &entry.changes)
        .filter(|change| REFERENCE_FIELDS.contains(&change.field.as_str()))
        .flat_map(|change| [&change.before, &change.after])
        .filter_map(Value::as_str)
        .collect();
    ids.sort_unstable();
    ids.dedup();
    let mut names = BTreeMap::new();
    if ids.is_empty() {
        return Ok(names);
    }
    let ids_json = serde_json::to_string(&ids).unwrap_or_default();
    let lookups = [
        "SELECT id, first_name || ' ' || last_name FROM clients
         WHERE id IN (SELECT value FROM json_each(?1))",
        "SELECT id, title FROM projects WHERE id IN (SELECT value FROM json_each(?1))",
        "SELECT s.id, c.first_name || ' ' || c.last_name || ' · ' || strftime('%d/%m/%Y', s.date)
         FROM sessions s JOIN clients c ON c.id = s.client_id
         WHERE s.id IN (SELECT value FROM json_each(?1))",
        "SELECT id, name || ' · lot ' || lot_number FROM lots
         WHERE id IN (SELECT value FROM json_each(?1))",
        "SELECT id, CASE WHEN brand IS NULL THEN name ELSE brand || ' ' || name END
         FROM product_sheets WHERE id IN (SELECT value FROM json_each(?1))",
        "SELECT d.id, 'Acompte · ' || c.first_name || ' ' || c.last_name
         FROM deposits d JOIN clients c ON c.id = d.client_id
         WHERE d.id IN (SELECT value FROM json_each(?1))",
    ];
    for lookup in lookups {
        let found: Vec<(String, String)> = sqlx::query_as(lookup)
            .bind(&ids_json)
            .fetch_all(pool)
            .await?;
        names.extend(found);
    }
    let paths = categories::category_paths(pool).await?;
    for id in ids {
        if let Some(path) = paths.get(id) {
            names.insert(id.to_string(), path.clone());
        }
    }
    Ok(names)
}

/// Réception d'un usage multiple : une entrée pour toutes les pièces reçues
/// (les déclencheurs ignorent les achats pièce par pièce).
pub(crate) async fn record_units_received(
    tx: &mut Transaction<'_, Sqlite>,
    lot_id: &str,
    quantity: i64,
) -> Result<(), sqlx::Error> {
    let after = serde_json::json!({
        "type": "PURCHASE",
        "quantity": quantity,
        "unit_id": null,
        "session_id": null,
        "reason": null,
    });
    sqlx::query(&format!(
        "INSERT INTO audit_log
            (occurred_at, action, entity, entity_id, label, lot_id, after_json)
         SELECT {now}, 'CREATE', 'stock_movement', NULL,
                name || ' · lot ' || lot_number, id, ?2
         FROM lots WHERE id = ?1",
        now = sql::NOW
    ))
    .bind(lot_id)
    .bind(after.to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Écrit un événement de l'app (sécurité, sauvegarde, export).
pub async fn record_event(
    pool: &SqlitePool,
    action: &str,
    details: Value,
) -> Result<(), sqlx::Error> {
    let after = match details {
        Value::Null => None,
        other => Some(other.to_string()),
    };
    sqlx::query(&format!(
        "INSERT INTO audit_log (occurred_at, action, entity, after_json)
         VALUES ({now}, ?, 'app', ?)",
        now = sql::NOW
    ))
    .bind(action)
    .bind(after)
    .execute(pool)
    .await?;
    Ok(())
}

/// Comme [`record_event`], pour une action déjà faite (fichier écrit, coffre
/// enregistré) : un échec du journal est signalé dans les logs, sans annuler
/// l'action ni afficher d'erreur.
pub async fn record_event_after(pool: &SqlitePool, action: &str, details: Value) {
    if let Err(error) = record_event(pool, action, details).await {
        eprintln!("journal : entrée {action} non écrite");
        sql::log_database_error(&error);
    }
}

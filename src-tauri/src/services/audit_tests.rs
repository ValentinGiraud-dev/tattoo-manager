//! Journal d'audit : chaque écriture laisse une trace, le journal ne s'efface pas,
//! les réponses de santé n'y sont jamais recopiées.

use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::audit::{self, event, AuditGroup, AuditQuery};
use super::billing::{self, PaymentInput, PaymentMethod};
use super::categories::{self, CategoryInput};
use super::clients::{self, ClientInput};
use super::lots::{self, CreateLotInput};
use super::paperwork::{self, HealthAnswers};
use super::product_sheets::{self, ProductSheetInput};
use super::sessions::{self, SessionInput};
use crate::models::SessionStatus;

async fn db() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .in_memory(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn client_input(first: &str, phone: Option<&str>) -> ClientInput {
    ClientInput {
        first_name: first.into(),
        last_name: "Martin".into(),
        birth_date: None,
        address: None,
        email: None,
        phone: phone.map(Into::into),
        notes: None,
    }
}

async fn session_for(pool: &SqlitePool, client_id: &str) -> String {
    sessions::create_session(
        pool,
        SessionInput {
            client_id: client_id.into(),
            project_id: None,
            date: "2026-10-05".into(),
            start_time: None,
            duration_minutes: None,
            status: SessionStatus::Completed,
            price_cents: Some(15_000),
            body_area: None,
            description: None,
            notes: None,
            title: None,
        },
    )
    .await
    .unwrap()
    .id
}

fn lot(name: &str, single_use: bool, quantity: i64) -> CreateLotInput {
    CreateLotInput {
        name: name.into(),
        lot_number: "L-1".into(),
        creation_date: None,
        expiration_date: "2030-01-01".into(),
        single_use,
        after_opening_months: if single_use { None } else { Some(6) },
        product_url: None,
        quantity,
        category_id: None,
        product_id: None,
    }
}

async fn all(pool: &SqlitePool) -> Vec<audit::AuditEntry> {
    audit::list_entries(
        pool,
        AuditQuery {
            limit: Some(500),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .entries
}

fn summary(entries: &[audit::AuditEntry]) -> Vec<(String, String)> {
    entries
        .iter()
        .map(|entry| (entry.action.clone(), entry.entity.clone()))
        .collect()
}

#[tokio::test]
async fn every_write_is_logged_with_what_changed() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input("Léa", None))
        .await
        .unwrap();
    // Enregistrer sans rien changer ne crée pas d'entrée.
    clients::update_client(&pool, &client.id, client_input("Léa", None))
        .await
        .unwrap();
    clients::update_client(&pool, &client.id, client_input("Léa", Some("0601020304")))
        .await
        .unwrap();

    let entries = all(&pool).await;
    assert_eq!(
        summary(&entries),
        [
            ("UPDATE".into(), "client".into()),
            ("CREATE".into(), "client".into()),
            ("JOURNAL_STARTED".into(), "app".into()),
        ]
    );
    let update = &entries[0];
    assert_eq!(update.label.as_deref(), Some("Léa Martin"));
    assert_eq!(update.client_id.as_deref(), Some(client.id.as_str()));
    assert_eq!(
        update.changes,
        [audit::AuditChange {
            field: "phone".into(),
            before: Value::Null,
            after: json!("0601020304"),
        }]
    );
    // Création : seuls les champs renseignés.
    let fields: Vec<_> = entries[1]
        .changes
        .iter()
        .map(|c| c.field.as_str())
        .collect();
    assert_eq!(fields, ["first_name", "last_name"]);
}

#[tokio::test]
async fn health_answers_never_reach_the_journal() {
    let pool = db().await;
    let client = clients::create_client(&pool, client_input("Léa", None))
        .await
        .unwrap();
    let session = session_for(&pool, &client.id).await;
    let answers = HealthAnswers {
        diabetes: Some(true),
        details: Some("Traitement secret XYZ".into()),
        ..Default::default()
    };
    paperwork::save_health(&pool, &session, answers.clone())
        .await
        .unwrap();
    paperwork::save_health(
        &pool,
        &session,
        HealthAnswers {
            epilepsy: Some(true),
            ..answers
        },
    )
    .await
    .unwrap();

    let raw: Vec<String> = sqlx::query_scalar(
        "SELECT COALESCE(before_json, '') || COALESCE(after_json, '') || COALESCE(label, '')
         FROM audit_log",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(raw
        .iter()
        .all(|text| !text.contains("XYZ") && !text.contains("diabetes")));

    let forms: Vec<_> = all(&pool)
        .await
        .into_iter()
        .filter(|entry| entry.entity == "session_form")
        .collect();
    assert_eq!(summary(&forms)[0], ("UPDATE".into(), "session_form".into()));
    // La modification est notée, sans aucune réponse.
    assert!(forms[0].changes.is_empty());
    assert_eq!(forms[0].session_id.as_deref(), Some(session.as_str()));
    assert_eq!(forms[0].client_id.as_deref(), Some(client.id.as_str()));
}

#[tokio::test]
async fn the_journal_cannot_be_changed_or_erased() {
    let pool = db().await;
    clients::create_client(&pool, client_input("Léa", None))
        .await
        .unwrap();
    for statement in [
        "UPDATE audit_log SET label = 'x'",
        "DELETE FROM audit_log",
        "DELETE FROM audit_log WHERE seq = 1",
    ] {
        let error = sqlx::query(statement).execute(&pool).await.unwrap_err();
        assert!(error.to_string().contains("Le journal ne"), "{statement}");
    }
    assert_eq!(all(&pool).await.len(), 2);
}

#[tokio::test]
async fn a_delivery_is_one_entry_not_one_per_piece() {
    let pool = db().await;
    let machines = lots::create_lot(&pool, lot("Grip", false, 5))
        .await
        .unwrap();
    lots::create_lot(&pool, lot("Gants", true, 100))
        .await
        .unwrap();

    let movements: Vec<_> = all(&pool)
        .await
        .into_iter()
        .filter(|entry| entry.entity != "lot" && entry.entity != "app")
        .collect();
    let quantities: Vec<_> = movements
        .iter()
        .map(|entry| {
            let quantity = entry
                .changes
                .iter()
                .find(|change| change.field == "quantity")
                .map(|change| change.after.clone());
            (entry.entity.as_str(), entry.label.clone(), quantity)
        })
        .collect();
    assert_eq!(
        quantities,
        [
            (
                "stock_movement",
                Some("Gants · lot L-1".into()),
                Some(json!(100))
            ),
            (
                "stock_movement",
                Some("Grip · lot L-1".into()),
                Some(json!(5))
            ),
        ]
    );
    assert_eq!(movements[1].lot_id.as_deref(), Some(machines.id.as_str()));
}

#[tokio::test]
async fn history_filters_by_record_family_and_period() {
    let pool = db().await;
    let lea = clients::create_client(&pool, client_input("Léa", None))
        .await
        .unwrap();
    let tom = clients::create_client(&pool, client_input("Tom", None))
        .await
        .unwrap();
    let session = session_for(&pool, &lea.id).await;
    session_for(&pool, &tom.id).await;
    billing::record_payment(
        &pool,
        PaymentInput {
            session_id: session.clone(),
            amount_cents: 5_000,
            method: PaymentMethod::Card,
            paid_on: "2026-10-05".into(),
            note: None,
        },
    )
    .await
    .unwrap();

    let query = |query: AuditQuery| {
        let pool = pool.clone();
        async move { audit::list_entries(&pool, query).await }
    };

    // Fiche client : la cliente, sa séance et son paiement, rien de Tom.
    let page = query(AuditQuery {
        client_id: Some(lea.id.clone()),
        ..Default::default()
    })
    .await
    .unwrap();
    assert_eq!(
        summary(&page.entries),
        [
            ("CREATE".into(), "payment".into()),
            ("CREATE".into(), "session".into()),
            ("CREATE".into(), "client".into()),
        ]
    );
    // Le paiement cite la séance : son nom est joint.
    assert_eq!(
        page.names.get(&session).map(String::as_str),
        Some("Léa Martin · 05/10/2026")
    );

    let page = query(AuditQuery {
        session_id: Some(session.clone()),
        group: Some(AuditGroup::Billing),
        ..Default::default()
    })
    .await
    .unwrap();
    assert_eq!(
        summary(&page.entries),
        [("CREATE".into(), "payment".into())]
    );

    // Pagination.
    let first = query(AuditQuery {
        limit: Some(2),
        ..Default::default()
    })
    .await
    .unwrap();
    assert!(first.has_more);
    let next = query(AuditQuery {
        limit: Some(100),
        before_seq: Some(first.entries[1].seq),
        ..Default::default()
    })
    .await
    .unwrap();
    assert!(!next.has_more);
    assert_eq!(
        first.entries.len() + next.entries.len(),
        all(&pool).await.len()
    );

    // Période : rien en 2020, tout aujourd'hui ; dates refusées.
    let old = query(AuditQuery {
        from: Some("2020-01-01".into()),
        to: Some("2020-12-31".into()),
        ..Default::default()
    })
    .await
    .unwrap();
    assert!(old.entries.is_empty());
    for (from, to, message) in [
        (
            "2026-02-01",
            "2026-01-01",
            "La date de début doit précéder la date de fin",
        ),
        ("01/01/2026", "2026-01-31", "Période invalide"),
    ] {
        let error = query(AuditQuery {
            from: Some(from.into()),
            to: Some(to.into()),
            ..Default::default()
        })
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), message);
    }
}

#[tokio::test]
async fn deleting_a_category_is_logged_with_what_moved() {
    let pool = db().await;
    let needles = categories::create_category(
        &pool,
        CategoryInput {
            name: "Aiguilles".into(),
            parent_id: None,
        },
    )
    .await
    .unwrap();
    let rl = categories::create_category(
        &pool,
        CategoryInput {
            name: "RL".into(),
            parent_id: Some(needles.id.clone()),
        },
    )
    .await
    .unwrap();
    let created = lots::create_lot(
        &pool,
        CreateLotInput {
            category_id: Some(rl.id.clone()),
            ..lot("Aiguille 3RL", true, 10)
        },
    )
    .await
    .unwrap();
    categories::delete_category(&pool, &rl.id).await.unwrap();

    let page = audit::list_entries(
        &pool,
        AuditQuery {
            lot_id: Some(created.id.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let moved = &page.entries[0];
    assert_eq!(
        (moved.action.as_str(), moved.entity.as_str()),
        ("UPDATE", "lot")
    );
    assert_eq!(moved.changes[0].field, "category_id");
    // L'ancienne catégorie n'existe plus : pas de nom ; la nouvelle est nommée.
    assert!(!page.names.contains_key(&rl.id));
    assert_eq!(
        page.names.get(&needles.id).map(String::as_str),
        Some("Aiguilles")
    );
    let deleted = all(&pool)
        .await
        .into_iter()
        .find(|entry| entry.action == "DELETE")
        .unwrap();
    assert_eq!(deleted.label.as_deref(), Some("RL"));
}

#[tokio::test]
async fn product_history_filters_one_sheet() {
    let pool = db().await;
    let sheet = |name: &str| ProductSheetInput {
        name: name.into(),
        brand: None,
        category_id: None,
        single_use: true,
        after_opening_months: None,
        product_url: None,
        low_stock_threshold: None,
        expiry_warning_days: None,
    };
    let red = product_sheets::create_sheet(&pool, sheet("Encre rouge"), vec![])
        .await
        .unwrap();
    let black = product_sheets::create_sheet(&pool, sheet("Encre noire"), vec![])
        .await
        .unwrap();

    let page = audit::list_entries(
        &pool,
        AuditQuery {
            entity: Some("product".into()),
            entity_id: Some(red.id.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    assert!(!page.entries.is_empty());
    assert!(page.entries.iter().all(|entry| {
        entry.entity == "product" && entry.entity_id.as_deref() == Some(red.id.as_str())
    }));
    assert!(page
        .entries
        .iter()
        .all(|entry| entry.entity_id.as_deref() != Some(black.id.as_str())));
}

/// Garde-fou pour les futures migrations : toute table métier est journalisée,
/// et chacune de ses colonnes est suivie ou volontairement écartée.
#[tokio::test]
async fn audit_triggers_cover_every_column() {
    let pool = db().await;
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           AND name NOT IN ('_sqlx_migrations', 'audit_log', 'schema_flags')
         ORDER BY name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    // Colonnes jamais recopiées : identifiant, horodatages techniques, réponses
    // de santé, nom interne du fichier chiffré.
    let skipped = ["id", "created_at", "updated_at", "answers", "stored_name"];
    for table in tables {
        let triggers: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'trigger' AND tbl_name = ? AND name LIKE 'audit_%'",
        )
        .bind(&table)
        .fetch_all(&pool)
        .await
        .unwrap();
        let names: Vec<_> = triggers.iter().map(|(name, _)| name.as_str()).collect();
        for kind in ["update", "delete"] {
            assert!(
                names.contains(&format!("audit_{table}_{kind}").as_str()),
                "{table} : déclencheur {kind} manquant"
            );
        }
        if table != "units" {
            assert!(
                names.contains(&format!("audit_{table}_insert").as_str()),
                "{table} : déclencheur insert manquant"
            );
        }
        let update_sql = &triggers
            .iter()
            .find(|(name, _)| name.ends_with("_update"))
            .unwrap()
            .1;
        let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info(?)")
            .bind(&table)
            .fetch_all(&pool)
            .await
            .unwrap();
        for column in columns {
            if skipped.contains(&column.as_str()) {
                continue;
            }
            assert!(
                update_sql.contains(&format!("'{column}', NEW.{column}")),
                "{table}.{column} n'est pas suivi par le journal"
            );
        }
    }
}

#[tokio::test]
async fn backups_do_not_count_as_changes_but_exports_do() {
    let pool = db().await;
    let start = crate::external_backup::fingerprint(&pool).await.unwrap();
    audit::record_event(&pool, event::BACKUP_CREATED, json!({ "automatic": true }))
        .await
        .unwrap();
    assert_eq!(
        crate::external_backup::fingerprint(&pool).await.unwrap(),
        start
    );
    audit::record_event(
        &pool,
        event::CSV_EXPORTED,
        json!({ "kind": "PAYMENTS", "from": "2026-01-01", "to": "2026-01-31", "rows": 3 }),
    )
    .await
    .unwrap();
    assert_ne!(
        crate::external_backup::fingerprint(&pool).await.unwrap(),
        start
    );
    let entries = all(&pool).await;
    assert_eq!(entries[0].action, event::CSV_EXPORTED);
    assert_eq!(entries[0].changes.len(), 4);
}

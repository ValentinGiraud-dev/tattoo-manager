//! Fiches produit : création, réception de lots, rattachement des lots existants,
//! et migration 013 sans effet sur les lots déjà enregistrés.

use std::path::PathBuf;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Connection, SqlitePool};

use super::categories::{self, CategoryInput};
use super::dashboard::EXPIRY_WARNING_INVALID;
use super::lots::{self, CreateLotInput, UpdateLotInput};
use super::product_sheets::{
    self, ProductSheetInput, SHEET_GONE, SHEET_HAS_LOTS, SHEET_TAKEN, TYPE_LOCKED, TYPE_MISMATCH,
};
use super::session_usages::{self, LinkSessionInput};
use super::sessions::{self, SessionInput};
use super::units;
use crate::models::SessionStatus;

async fn memory_pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .in_memory(true)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap()
}

async fn db() -> SqlitePool {
    let pool = memory_pool().await;
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

fn sheet(name: &str, brand: Option<&str>, single_use: bool) -> ProductSheetInput {
    ProductSheetInput {
        name: name.into(),
        brand: brand.map(Into::into),
        category_id: None,
        single_use,
        after_opening_months: if single_use { None } else { Some(12) },
        product_url: None,
        low_stock_threshold: None,
        expiry_warning_days: None,
    }
}

fn lot(name: &str, number: &str, single_use: bool, quantity: i64) -> CreateLotInput {
    CreateLotInput {
        name: name.into(),
        lot_number: number.into(),
        creation_date: None,
        expiration_date: "2030-01-01".into(),
        single_use,
        after_opening_months: None,
        product_url: None,
        quantity,
        category_id: None,
        product_id: None,
    }
}

async fn category(pool: &SqlitePool, name: &str) -> String {
    categories::create_category(
        pool,
        CategoryInput {
            name: name.into(),
            parent_id: None,
        },
    )
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn a_lot_received_from_a_sheet_takes_its_name_type_and_category() {
    let pool = db().await;
    let inks = category(&pool, "Encres").await;
    let sheet = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            category_id: Some(inks.clone()),
            ..sheet("Triple Black", Some("Dynamic"), false)
        },
        vec![],
    )
    .await
    .unwrap();
    assert_eq!(sheet.display_name, "Dynamic Triple Black");
    assert_eq!(sheet.category_path.as_deref(), Some("Encres"));

    // Les champs du lot repris de la fiche sont ignorés s'ils diffèrent.
    let received = lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some(sheet.id.clone()),
            category_id: None,
            ..lot("n'importe quoi", "DTB-1", true, 6)
        },
    )
    .await
    .unwrap();
    assert_eq!(received.name, "Dynamic Triple Black");
    assert!(!received.single_use);
    assert_eq!(received.after_opening_months, Some(12));
    assert_eq!(received.category_id.as_deref(), Some(inks.as_str()));
    assert_eq!(received.product_id.as_deref(), Some(sheet.id.as_str()));
    assert_eq!(received.product_brand.as_deref(), Some("Dynamic"));
    assert_eq!(received.stock, 6);

    // Deuxième réception du même lot : le stock s'ajoute.
    lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some(sheet.id.clone()),
            ..lot("", "dtb-1", false, 2)
        },
    )
    .await
    .unwrap();
    let sheet = product_sheets::get_sheet(&pool, &sheet.id).await.unwrap();
    assert_eq!((sheet.lot_count, sheet.stock), (1, 8));

    let error = lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some("inconnue".into()),
            ..lot("Encre", "X", false, 1)
        },
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), SHEET_GONE);
}

#[tokio::test]
async fn a_sheet_is_identified_by_name_and_brand() {
    let pool = db().await;
    product_sheets::create_sheet(&pool, sheet("Triple Black", Some("Dynamic"), false), vec![])
        .await
        .unwrap();
    // Même nom, autre marque (ou sans marque) : autre fiche.
    product_sheets::create_sheet(&pool, sheet("Triple Black", Some("Eternal"), false), vec![])
        .await
        .unwrap();
    product_sheets::create_sheet(&pool, sheet("Triple Black", None, false), vec![])
        .await
        .unwrap();

    for (input, message) in [
        (sheet("triple  black", Some("DYNAMIC"), false), SHEET_TAKEN),
        (sheet("TRIPLE BLACK", None, false), SHEET_TAKEN),
        (
            sheet("   ", None, true),
            "Le nom du produit est obligatoire",
        ),
        (
            ProductSheetInput {
                after_opening_months: Some(6),
                ..sheet("Gants", None, true)
            },
            "Un usage unique n'a pas de durée après ouverture",
        ),
    ] {
        let error = product_sheets::create_sheet(&pool, input, vec![])
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), message);
    }
    let names: Vec<_> = product_sheets::list_sheets(&pool, None, None)
        .await
        .unwrap()
        .into_iter()
        .map(|sheet| sheet.display_name)
        .collect();
    assert_eq!(
        names,
        [
            "Triple Black",
            "Dynamic Triple Black",
            "Eternal Triple Black"
        ]
    );
}

#[tokio::test]
async fn existing_lots_are_attached_without_touching_their_identity() {
    let pool = db().await;
    sqlx::query(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Léa', 'Martin', '2026-01-01T00:00:00', '2026-01-01T00:00:00')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let session = sessions::create_session(
        &pool,
        SessionInput {
            client_id: "c1".into(),
            project_id: None,
            date: "2026-10-05".into(),
            start_time: None,
            duration_minutes: None,
            status: SessionStatus::Completed,
            price_cents: None,
            body_area: None,
            description: None,
            notes: None,
            title: None,
        },
    )
    .await
    .unwrap();
    let old = lots::create_lot(&pool, lot("encre noire", "A1", false, 2))
        .await
        .unwrap();
    let other = lots::create_lot(&pool, lot("Encre noire", "B7", false, 1))
        .await
        .unwrap();
    let needle = lots::create_lot(&pool, lot("Aiguille 3RL", "N1", true, 50))
        .await
        .unwrap();
    let unit = super::units::list_units(&pool, &old.id).await.unwrap()[0]
        .id
        .clone();
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session.id,
            lot_id: None,
            unit_id: Some(unit),
            quantity: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(old.product_id, None);

    // Un lot d'un autre type fait tout échouer : aucune fiche n'est créée.
    let error = product_sheets::create_sheet(
        &pool,
        sheet("Encre noire", Some("Dynamic"), false),
        vec![old.id.clone(), needle.id.clone()],
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), TYPE_MISMATCH);
    assert!(product_sheets::list_sheets(&pool, None, None)
        .await
        .unwrap()
        .is_empty());

    let inks = category(&pool, "Encres").await;
    let created = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            category_id: Some(inks.clone()),
            ..sheet("Encre noire", Some("Dynamic"), false)
        },
        vec![old.id.clone(), other.id.clone()],
    )
    .await
    .unwrap();
    // Un flacon lié à une séance reste en stock tant qu'il n'est pas terminé.
    assert_eq!((created.lot_count, created.stock), (2, 3));

    let attached = lots::get_lot(&pool, &old.id).await.unwrap();
    // Identité tracée inchangée, même pour un lot déjà utilisé en séance.
    assert_eq!(attached.name, "encre noire");
    assert_eq!(attached.lot_number, "A1");
    assert_eq!(attached.product_id.as_deref(), Some(created.id.as_str()));
    assert_eq!(attached.category_path.as_deref(), Some("Encres"));

    // Détacher puis rattacher un lot.
    let detached = product_sheets::set_lot_sheet(&pool, &other.id, None)
        .await
        .unwrap();
    assert_eq!(detached.product_id, None);
    let error = product_sheets::set_lot_sheet(&pool, &needle.id, Some(created.id.clone()))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), TYPE_MISMATCH);
}

#[tokio::test]
async fn receiving_a_lot_known_before_sheets_attaches_it() {
    let pool = db().await;
    let legacy = lots::create_lot(&pool, lot("Dynamic Triple Black", "DTB-1", false, 2))
        .await
        .unwrap();
    let dynamic =
        product_sheets::create_sheet(&pool, sheet("Triple Black", Some("Dynamic"), false), vec![])
            .await
            .unwrap();
    let received = lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some(dynamic.id.clone()),
            ..lot("", "DTB-1", false, 3)
        },
    )
    .await
    .unwrap();
    assert_eq!(received.id, legacy.id);
    assert_eq!(received.stock, 5);
    assert_eq!(received.product_id.as_deref(), Some(dynamic.id.as_str()));

    // Le même nom et numéro sous une autre fiche : refusé, rien ne change.
    let homonym =
        product_sheets::create_sheet(&pool, sheet("Dynamic Triple Black", None, false), vec![])
            .await
            .unwrap();
    let error = lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some(homonym.id),
            ..lot("", "DTB-1", false, 1)
        },
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("autre fiche produit"));
    assert_eq!(lots::get_lot(&pool, &legacy.id).await.unwrap().stock, 5);
}

#[tokio::test]
async fn editing_a_sheet_moves_its_lots_but_never_changes_their_type() {
    let pool = db().await;
    let inks = category(&pool, "Encres").await;
    let blacks = category(&pool, "Noires").await;
    let created = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            category_id: Some(inks),
            ..sheet("Triple Black", Some("Dynamic"), false)
        },
        vec![],
    )
    .await
    .unwrap();
    let received = lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some(created.id.clone()),
            ..lot("", "DTB-1", false, 1)
        },
    )
    .await
    .unwrap();

    let moved = product_sheets::update_sheet(
        &pool,
        &created.id,
        ProductSheetInput {
            category_id: Some(blacks.clone()),
            after_opening_months: Some(6),
            ..sheet("Triple Black", Some("Dynamic"), false)
        },
    )
    .await
    .unwrap();
    assert_eq!(moved.category_path.as_deref(), Some("Noires"));
    let lot_now = lots::get_lot(&pool, &received.id).await.unwrap();
    assert_eq!(lot_now.category_path.as_deref(), Some("Noires"));
    // La durée de la fiche vaut pour les prochains lots, pas pour ceux reçus.
    assert_eq!(lot_now.after_opening_months, Some(12));

    // Modifier le lot ne le sort pas de la catégorie de sa fiche.
    let edited = lots::update_lot(
        &pool,
        &received.id,
        UpdateLotInput {
            name: lot_now.name.clone(),
            lot_number: lot_now.lot_number.clone(),
            creation_date: None,
            expiration_date: lot_now.expiration_date.clone(),
            after_opening_months: Some(12),
            product_url: None,
            category_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(edited.category_id.as_deref(), Some(blacks.as_str()));

    let error = product_sheets::update_sheet(
        &pool,
        &created.id,
        sheet("Triple Black", Some("Dynamic"), true),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), TYPE_LOCKED);

    // Supprimer : refusé tant qu'il reste des lots.
    let error = product_sheets::delete_sheet(&pool, &created.id)
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), SHEET_HAS_LOTS);
    product_sheets::set_lot_sheet(&pool, &received.id, None)
        .await
        .unwrap();
    product_sheets::delete_sheet(&pool, &created.id)
        .await
        .unwrap();
    // Le lot détaché garde sa catégorie.
    let kept = lots::get_lot(&pool, &received.id).await.unwrap();
    assert_eq!(kept.category_id.as_deref(), Some(blacks.as_str()));
}

#[tokio::test]
async fn sheet_stock_counts_only_lots_that_are_not_expired() {
    let pool = db().await;
    let gloves = product_sheets::create_sheet(&pool, sheet("Gants M", None, true), vec![])
        .await
        .unwrap();
    for (number, expiration, quantity) in [("G1", "2020-01-01", 5), ("G2", "2030-01-01", 3)] {
        lots::create_lot(
            &pool,
            CreateLotInput {
                product_id: Some(gloves.id.clone()),
                expiration_date: expiration.into(),
                ..lot("", number, true, quantity)
            },
        )
        .await
        .unwrap();
    }
    let gloves = product_sheets::get_sheet(&pool, &gloves.id).await.unwrap();
    assert_eq!((gloves.stock, gloves.expired_stock), (3, 5));

    // La recherche trouve une fiche par un de ses numéros de lot.
    let found = product_sheets::list_sheets(&pool, Some("g2".into()), None)
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
}

#[tokio::test]
async fn deleting_a_category_lifts_sheets_and_counts_follow() {
    let pool = db().await;
    let inks = category(&pool, "Encres").await;
    let blacks = categories::create_category(
        &pool,
        CategoryInput {
            name: "Noires".into(),
            parent_id: Some(inks.clone()),
        },
    )
    .await
    .unwrap()
    .id;
    let created = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            category_id: Some(blacks.clone()),
            ..sheet("Triple Black", Some("Dynamic"), false)
        },
        vec![],
    )
    .await
    .unwrap();
    for number in ["A", "B"] {
        lots::create_lot(
            &pool,
            CreateLotInput {
                product_id: Some(created.id.clone()),
                ..lot("", number, false, 1)
            },
        )
        .await
        .unwrap();
    }
    // Un lot sans fiche compte aussi comme un produit.
    lots::create_lot(
        &pool,
        CreateLotInput {
            category_id: Some(blacks.clone()),
            ..lot("Encre maison", "M1", false, 1)
        },
    )
    .await
    .unwrap();
    let tree = categories::list_categories(&pool).await.unwrap();
    let counts: Vec<_> = tree
        .iter()
        .map(|c| (c.path.as_str(), c.total_lot_count))
        .collect();
    assert_eq!(counts, [("Encres", 2), ("Encres › Noires", 2)]);

    categories::delete_category(&pool, &blacks).await.unwrap();
    let lifted = product_sheets::get_sheet(&pool, &created.id).await.unwrap();
    assert_eq!(lifted.category_id.as_deref(), Some(inks.as_str()));
    let lots = lots::list_lots(&pool, None, None).await.unwrap();
    assert!(lots
        .iter()
        .all(|lot| lot.category_id.as_deref() == Some(inks.as_str())));
}

fn migration(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("migrations")
        .join(name);
    std::fs::read_to_string(path).unwrap()
}

/// Comme sqlx : chaque migration dans une transaction.
async fn run(pool: &SqlitePool, name: &str) {
    let mut conn = pool.acquire().await.unwrap();
    let mut tx = conn.begin().await.unwrap();
    sqlx::raw_sql(&migration(name))
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

/// La migration 013 n'ajoute que des tables et une colonne vide : les lots déjà
/// enregistrés (stock, liens de séance, catégorie) restent tels quels, sans fiche.
#[tokio::test]
async fn migration_013_leaves_existing_lots_untouched() {
    let pool = memory_pool().await;
    let mut files: Vec<String> =
        std::fs::read_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("migrations"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| name.as_str() < "013")
            .collect();
    files.sort();
    for file in &files {
        run(&pool, file).await;
    }

    sqlx::raw_sql(
        "INSERT INTO product_categories (id, parent_id, name, created_at, updated_at)
             VALUES ('cat', NULL, 'Encres', 't', 't');
         INSERT INTO lots (id, name, lot_number, expiration_date, single_use,
                           after_opening_months, category_id, created_at, updated_at)
             VALUES ('ink', 'Encre noire', 'A1', '2030-01-01', 0, 12, 'cat', 't', 't'),
                    ('glove', 'Gants M', 'G1', '2030-01-01', 1, NULL, NULL, 't', 't');
         INSERT INTO units (id, lot_id, opened_at, created_at, updated_at)
             VALUES ('u1', 'ink', '2026-01-02', 't', 't'), ('u2', 'ink', NULL, 't', 't');
         INSERT INTO stock_movements (id, lot_id, unit_id, type, quantity, created_at)
             VALUES ('m1', 'ink', 'u1', 'PURCHASE', 1, 't'),
                    ('m2', 'ink', 'u2', 'PURCHASE', 1, 't'),
                    ('m3', 'glove', NULL, 'PURCHASE', 100, 't');",
    )
    .execute(&pool)
    .await
    .unwrap();
    let before: Vec<(String, String, String, i64)> =
        sqlx::query_as("SELECT id, name, lot_number, single_use FROM lots ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    let audit_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    run(&pool, "013_product_sheets.sql").await;

    let after: Vec<(String, String, String, i64)> =
        sqlx::query_as("SELECT id, name, lot_number, single_use FROM lots ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(after, before);
    // Les lectures actuelles utilisent aussi les colonnes des migrations suivantes.
    run(&pool, "014_low_stock.sql").await;
    run(&pool, "015_client_archives.sql").await;
    run(&pool, "016_archives.sql").await;
    let listed = lots::list_lots(&pool, None, None).await.unwrap();
    let ink = listed.iter().find(|lot| lot.id == "ink").unwrap();
    assert_eq!((ink.stock, ink.opened_count), (2, 1));
    assert_eq!(ink.category_path.as_deref(), Some("Encres"));
    assert!(listed.iter().all(|lot| lot.product_id.is_none()));
    // Rien n'a été réécrit : aucune entrée de journal ajoutée par la migration.
    let audit_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_after, audit_before);
}

fn day(date: chrono::NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

#[tokio::test]
async fn a_sheet_warns_before_expiry_and_keeps_flagging_what_is_already_expired() {
    let pool = db().await;
    let today = chrono::Local::now().date_naive();
    let created = product_sheets::create_sheet(&pool, sheet("Gants", None, true), vec![])
        .await
        .unwrap();
    assert_eq!(created.expiry_warning_days, None);
    assert_eq!(created.expiry_alert_days, 30);
    assert!(created.expiry_notice.is_none());

    for (number, expiration) in [
        ("PERIME", "2020-01-01"),
        ("PROCHE", day(today + chrono::Duration::days(10)).as_str()),
        ("LOIN", day(today + chrono::Duration::days(40)).as_str()),
    ] {
        lots::create_lot(
            &pool,
            CreateLotInput {
                product_id: Some(created.id.clone()),
                lot_number: number.into(),
                expiration_date: expiration.into(),
                ..lot("", number, true, 2)
            },
        )
        .await
        .unwrap();
    }

    let view = product_sheets::get_sheet(&pool, &created.id).await.unwrap();
    let notice = view.expiry_notice.expect("périmé et bientôt");
    assert!(notice.expired);
    assert_eq!(notice.lot_number, "PERIME");
    assert_eq!(notice.useful_until, "2020-01-01");
    // Le lot à 40 jours est hors des 30 jours ; seul le lot à 10 jours s'ajoute.
    assert_eq!(notice.extra, 1);

    let narrowed = product_sheets::update_sheet(
        &pool,
        &created.id,
        ProductSheetInput {
            expiry_warning_days: Some(5),
            ..sheet("Gants", None, true)
        },
    )
    .await
    .unwrap();
    assert_eq!(narrowed.expiry_alert_days, 5);
    let notice = narrowed.expiry_notice.unwrap();
    assert!(notice.expired);
    assert_eq!(notice.extra, 0);

    let silent = product_sheets::update_sheet(
        &pool,
        &created.id,
        ProductSheetInput {
            expiry_warning_days: Some(0),
            ..sheet("Gants", None, true)
        },
    )
    .await
    .unwrap();
    assert_eq!(silent.expiry_alert_days, 0);
    let notice = silent.expiry_notice.unwrap();
    assert!(notice.expired);
    assert_eq!(notice.extra, 0);

    for days in [Some(-1), Some(3_651)] {
        let error = product_sheets::update_sheet(
            &pool,
            &created.id,
            ProductSheetInput {
                expiry_warning_days: days,
                ..sheet("Gants", None, true)
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), EXPIRY_WARNING_INVALID);
    }
}

#[tokio::test]
async fn an_opened_piece_is_warned_on_its_useful_limit() {
    let pool = db().await;
    let today = chrono::Local::now().date_naive();
    let limit = today + chrono::Duration::days(5);
    let opened = limit
        .checked_sub_months(chrono::Months::new(12))
        .expect("douze mois plus tôt");
    let created = product_sheets::create_sheet(&pool, sheet("Encre", None, false), vec![])
        .await
        .unwrap();
    let received = lots::create_lot(
        &pool,
        CreateLotInput {
            product_id: Some(created.id.clone()),
            lot_number: "ENC-1".into(),
            expiration_date: "2030-01-01".into(),
            ..lot("", "ENC-1", false, 2)
        },
    )
    .await
    .unwrap();
    let pieces = units::list_units(&pool, &received.id).await.unwrap();
    units::open_unit(&pool, &pieces[0].id, day(opened))
        .await
        .unwrap();

    let notice = product_sheets::get_sheet(&pool, &created.id)
        .await
        .unwrap()
        .expiry_notice
        .expect("pièce ouverte bientôt périmée");
    assert!(!notice.expired);
    assert_eq!(notice.lot_number, "ENC-1");
    assert_eq!(notice.useful_until, day(limit));
    assert_eq!(notice.extra, 0);
}

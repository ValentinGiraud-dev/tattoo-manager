//! Catégories de produits : arbre libre, noms uniques entre sœurs, pas de boucle,
//! suppression sans perte (le contenu remonte d'un niveau).

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::categories::{self, CategoryInput, CATEGORY_LOOP, SIBLING_NAME_TAKEN};
use super::lots::{self, CreateLotInput, UpdateLotInput};
use super::session_usages::{self, LinkSessionInput};
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

fn input(name: &str, parent: Option<&str>) -> CategoryInput {
    CategoryInput {
        name: name.into(),
        parent_id: parent.map(Into::into),
    }
}

async fn create(pool: &SqlitePool, name: &str, parent: Option<&str>) -> String {
    categories::create_category(pool, input(name, parent))
        .await
        .unwrap()
        .id
}

fn lot(name: &str, category: Option<&str>) -> CreateLotInput {
    CreateLotInput {
        name: name.into(),
        lot_number: "L-1".into(),
        creation_date: None,
        expiration_date: "2030-01-01".into(),
        single_use: true,
        after_opening_months: None,
        product_url: None,
        quantity: 10,
        category_id: category.map(Into::into),
        product_id: None,
    }
}

fn paths(list: &[categories::CategoryView]) -> Vec<&str> {
    list.iter().map(|c| c.path.as_str()).collect()
}

#[tokio::test]
async fn categories_nest_on_as_many_levels_as_needed() {
    let pool = db().await;
    let needles = create(&pool, "Aiguilles", None).await;
    let rl = create(&pool, "RL", Some(&needles)).await;
    let rl3 = create(&pool, "3RL", Some(&rl)).await;
    create(&pool, "Encres", None).await;
    create(&pool, "RM", Some(&needles)).await;

    lots::create_lot(&pool, lot("Aiguille 3RL 0,30", Some(&rl3)))
        .await
        .unwrap();
    lots::create_lot(&pool, lot("Aiguille RL vrac", Some(&rl)))
        .await
        .unwrap();

    let tree = categories::list_categories(&pool).await.unwrap();
    assert_eq!(
        paths(&tree),
        [
            "Aiguilles",
            "Aiguilles › RL",
            "Aiguilles › RL › 3RL",
            "Aiguilles › RM",
            "Encres"
        ]
    );
    let counts: Vec<_> = tree
        .iter()
        .map(|c| (c.depth, c.lot_count, c.total_lot_count))
        .collect();
    assert_eq!(
        counts,
        [(0, 0, 2), (1, 1, 2), (2, 1, 1), (1, 0, 0), (0, 0, 0)]
    );

    // Le lot porte le chemin complet de sa catégorie.
    let listed = lots::list_lots(&pool, None, None).await.unwrap();
    let paths: Vec<_> = listed
        .iter()
        .map(|l| (l.name.as_str(), l.category_path.as_deref()))
        .collect();
    assert_eq!(
        paths,
        [
            ("Aiguille 3RL 0,30", Some("Aiguilles › RL › 3RL")),
            ("Aiguille RL vrac", Some("Aiguilles › RL"))
        ]
    );
}

#[tokio::test]
async fn sibling_names_are_unique_but_cousins_may_share_a_name() {
    let pool = db().await;
    let needles = create(&pool, "Aiguilles", None).await;
    let cartridges = create(&pool, "Cartouches", None).await;
    create(&pool, "RL", Some(&needles)).await;
    // Même nom ailleurs dans l'arbre : permis.
    create(&pool, "RL", Some(&cartridges)).await;

    for (name, parent) in [("rl", Some(needles.as_str())), ("aiguilles", None)] {
        let error = categories::create_category(&pool, input(name, parent))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), SIBLING_NAME_TAKEN);
    }
    let error = categories::create_category(&pool, input("   ", None))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Le nom de la catégorie est obligatoire");
    let error = categories::create_category(&pool, input("X", Some("inconnue")))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Cette catégorie n'existe plus");
}

#[tokio::test]
async fn a_category_moves_with_its_content_but_never_into_itself() {
    let pool = db().await;
    let needles = create(&pool, "Aiguilles", None).await;
    let rl = create(&pool, "RL", Some(&needles)).await;
    let rl3 = create(&pool, "3RL", Some(&rl)).await;
    let consumables = create(&pool, "Consommables", None).await;

    for target in [&rl, &rl3] {
        let error = categories::update_category(&pool, &rl, input("RL", Some(target)))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), CATEGORY_LOOP);
    }

    // Déplacer « Aiguilles » dans « Consommables » emmène toute la branche.
    categories::update_category(&pool, &needles, input("Aiguilles", Some(&consumables)))
        .await
        .unwrap();
    let tree = categories::list_categories(&pool).await.unwrap();
    assert_eq!(
        paths(&tree),
        [
            "Consommables",
            "Consommables › Aiguilles",
            "Consommables › Aiguilles › RL",
            "Consommables › Aiguilles › RL › 3RL"
        ]
    );

    // Renommer, puis revenir à la racine.
    categories::update_category(&pool, &needles, input("Aiguilles de tatouage", None))
        .await
        .unwrap();
    let tree = categories::list_categories(&pool).await.unwrap();
    assert_eq!(tree[0].path, "Aiguilles de tatouage");
}

#[tokio::test]
async fn deleting_a_category_lifts_its_content_one_level_up() {
    let pool = db().await;
    let needles = create(&pool, "Aiguilles", None).await;
    let rl = create(&pool, "RL", Some(&needles)).await;
    create(&pool, "3RL", Some(&rl)).await;
    let lot_in_rl = lots::create_lot(&pool, lot("Aiguille RL", Some(&rl)))
        .await
        .unwrap();

    categories::delete_category(&pool, &rl).await.unwrap();
    let tree = categories::list_categories(&pool).await.unwrap();
    assert_eq!(paths(&tree), ["Aiguilles", "Aiguilles › 3RL"]);
    let moved = lots::get_lot(&pool, &lot_in_rl.id).await.unwrap();
    assert_eq!(moved.category_path.as_deref(), Some("Aiguilles"));

    // À la racine, le lot devient « sans catégorie ».
    categories::delete_category(&pool, &needles).await.unwrap();
    let moved = lots::get_lot(&pool, &lot_in_rl.id).await.unwrap();
    assert_eq!(moved.category_id, None);
    assert_eq!(
        paths(&categories::list_categories(&pool).await.unwrap()),
        ["3RL"]
    );
}

#[tokio::test]
async fn deleting_refuses_to_merge_two_categories_with_the_same_name() {
    let pool = db().await;
    let needles = create(&pool, "Aiguilles", None).await;
    let old = create(&pool, "Ancien rangement", Some(&needles)).await;
    create(&pool, "RL", Some(&needles)).await;
    create(&pool, "rl", Some(&old)).await;

    let error = categories::delete_category(&pool, &old).await.unwrap_err();
    assert!(error.to_string().contains("renommez-la"));
    assert_eq!(categories::list_categories(&pool).await.unwrap().len(), 4);
}

#[tokio::test]
async fn a_used_lot_keeps_its_identity_but_can_change_category() {
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
    let needles = create(&pool, "Aiguilles", None).await;
    let created = lots::create_lot(&pool, lot("Aiguille 3RL", None))
        .await
        .unwrap();
    session_usages::link_session(
        &pool,
        LinkSessionInput {
            session_id: session.id,
            lot_id: Some(created.id.clone()),
            unit_id: None,
            quantity: Some(1),
        },
    )
    .await
    .unwrap();

    let update = |category: Option<String>| UpdateLotInput {
        name: created.name.clone(),
        lot_number: created.lot_number.clone(),
        creation_date: None,
        expiration_date: created.expiration_date.clone(),
        after_opening_months: None,
        product_url: None,
        category_id: category,
    };
    let moved = lots::update_lot(&pool, &created.id, update(Some(needles.clone())))
        .await
        .unwrap();
    assert_eq!(moved.category_path.as_deref(), Some("Aiguilles"));

    let error = lots::update_lot(&pool, &created.id, update(Some("inconnue".into())))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "Cette catégorie n'existe plus");
}

#[tokio::test]
async fn adding_stock_to_an_existing_lot_can_file_it() {
    let pool = db().await;
    let inks = create(&pool, "Encres", None).await;
    let first = lots::create_lot(&pool, lot("Encre noire", None))
        .await
        .unwrap();
    assert_eq!(first.category_id, None);
    let again = lots::create_lot(&pool, lot("Encre noire", Some(&inks)))
        .await
        .unwrap();
    assert_eq!(again.id, first.id);
    assert_eq!(again.stock, 20);
    assert_eq!(again.category_path.as_deref(), Some("Encres"));
    // Sans catégorie choisie, celle du lot existant est gardée.
    let third = lots::create_lot(&pool, lot("Encre noire", None))
        .await
        .unwrap();
    assert_eq!(third.category_path.as_deref(), Some("Encres"));
}

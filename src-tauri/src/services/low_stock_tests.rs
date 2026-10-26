//! Stock bas : seuil de la fiche, seuil hérité de la catégorie, seuil sur le total
//! d'une catégorie ; et alertes sur l'accueil et au moment de lier une séance.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use super::categories::{self, CategoryInput, LowStockSetting};
use super::lots::{self, CreateLotInput};
use super::low_stock::{self, CategoryAlert, THRESHOLD_INVALID};
use super::product_sheets::{self, ProductSheetInput};
use super::session_usages;
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

async fn category(pool: &SqlitePool, name: &str, parent: Option<&str>) -> String {
    categories::create_category(
        pool,
        CategoryInput {
            name: name.into(),
            parent_id: parent.map(Into::into),
        },
    )
    .await
    .unwrap()
    .id
}

async fn set(pool: &SqlitePool, id: &str, mode: Option<&str>, threshold: Option<i64>) {
    categories::set_low_stock(
        pool,
        id,
        LowStockSetting {
            mode: mode.map(Into::into),
            threshold,
        },
    )
    .await
    .unwrap();
}

/// Fiche à usage unique, avec un lot du stock donné.
async fn sheet(
    pool: &SqlitePool,
    name: &str,
    category_id: Option<&str>,
    threshold: Option<i64>,
    stock: i64,
) -> String {
    let created = product_sheets::create_sheet(
        pool,
        ProductSheetInput {
            name: name.into(),
            brand: None,
            category_id: category_id.map(Into::into),
            single_use: true,
            after_opening_months: None,
            product_url: None,
            low_stock_threshold: threshold,
            expiry_warning_days: None,
        },
        vec![],
    )
    .await
    .unwrap();
    if stock > 0 {
        receive(pool, &created.id, "L1", "2030-01-01", stock).await;
    }
    created.id
}

async fn receive(pool: &SqlitePool, sheet_id: &str, number: &str, expiration: &str, qty: i64) {
    lots::create_lot(
        pool,
        CreateLotInput {
            name: String::new(),
            lot_number: number.into(),
            creation_date: None,
            expiration_date: expiration.into(),
            single_use: true,
            after_opening_months: None,
            product_url: None,
            quantity: qty,
            category_id: None,
            product_id: Some(sheet_id.into()),
        },
    )
    .await
    .unwrap();
}

async fn alerted(pool: &SqlitePool) -> Vec<(String, i64, i64, Option<String>)> {
    low_stock::report(pool)
        .await
        .unwrap()
        .sheets
        .into_iter()
        .map(|alert| {
            (
                alert.display_name,
                alert.stock,
                alert.threshold,
                alert.source,
            )
        })
        .collect()
}

#[tokio::test]
async fn a_sheet_alerts_at_or_below_its_own_threshold_counting_only_valid_lots() {
    let pool = db().await;
    let gloves = sheet(&pool, "Gants M", None, Some(2), 2).await;
    sheet(&pool, "Gants L", None, Some(2), 3).await;
    // Pas de seuil : pas d'alerte, même à zéro.
    sheet(&pool, "Film", None, None, 0).await;

    assert_eq!(alerted(&pool).await, [("Gants M".into(), 2, 2, None)]);

    // Un lot périmé ne compte pas dans le stock surveillé.
    receive(&pool, &gloves, "OLD", "2020-01-01", 50).await;
    let view = product_sheets::get_sheet(&pool, &gloves).await.unwrap();
    assert_eq!(
        (view.stock, view.expired_stock, view.low_stock),
        (2, 50, true)
    );

    // Réception : le stock repasse au-dessus du seuil.
    receive(&pool, &gloves, "L2", "2030-01-01", 1).await;
    assert!(alerted(&pool).await.is_empty());
}

#[tokio::test]
async fn sheets_inherit_the_nearest_per_product_category_threshold() {
    let pool = db().await;
    let inks = category(&pool, "Encres", None).await;
    let blacks = category(&pool, "Noires", Some(&inks)).await;
    set(&pool, &inks, Some("EACH"), Some(1)).await;

    let red = sheet(&pool, "Rouge", Some(&inks), None, 1).await;
    sheet(&pool, "Triple Black", Some(&blacks), None, 1).await;
    // 0 sur la fiche : jamais d'alerte pour ce produit.
    sheet(&pool, "Échantillon", Some(&inks), Some(0), 0).await;
    // Seuil de la fiche plus haut que celui de la catégorie.
    sheet(&pool, "Blanc", Some(&inks), Some(5), 4).await;

    assert_eq!(
        alerted(&pool).await,
        [
            ("Rouge".into(), 1, 1, Some("Encres".into())),
            ("Triple Black".into(), 1, 1, Some("Encres".into())),
            ("Blanc".into(), 4, 5, None),
        ]
    );

    // La catégorie la plus proche l'emporte.
    set(&pool, &blacks, Some("EACH"), Some(3)).await;
    let report = alerted(&pool).await;
    assert!(report.contains(&("Triple Black".into(), 1, 3, Some("Encres › Noires".into()))));

    // Retirer le seuil de « Encres » : « Rouge » n'est plus surveillé.
    set(&pool, &inks, None, None).await;
    let view = product_sheets::get_sheet(&pool, &red).await.unwrap();
    assert_eq!((view.alert_threshold, view.low_stock), (None, false));
}

#[tokio::test]
async fn a_total_threshold_watches_the_sum_of_a_category_branch() {
    let pool = db().await;
    let blacks = category(&pool, "Noires", None).await;
    let dynamic = category(&pool, "Dynamic", Some(&blacks)).await;
    set(&pool, &blacks, Some("TOTAL"), Some(5)).await;
    sheet(&pool, "Triple Black", Some(&dynamic), None, 2).await;
    sheet(&pool, "Blackout", Some(&blacks), None, 3).await;

    let report = low_stock::report(&pool).await.unwrap();
    // Le seuil « au total » ne s'applique pas à chaque produit.
    assert!(report.sheets.is_empty());
    assert_eq!(
        report.categories,
        [CategoryAlert {
            category_id: blacks.clone(),
            path: "Noires".into(),
            stock: 5,
            threshold: 5,
            sheet_count: 2,
        }]
    );

    let extra = sheet(&pool, "Lining Black", Some(&dynamic), None, 0).await;
    receive(&pool, &extra, "LB", "2030-01-01", 1).await;
    assert!(low_stock::report(&pool)
        .await
        .unwrap()
        .categories
        .is_empty());
}

#[tokio::test]
async fn category_settings_are_checked() {
    let pool = db().await;
    let inks = category(&pool, "Encres", None).await;
    for (mode, threshold, message) in [
        (Some("EACH"), None, THRESHOLD_INVALID),
        (Some("TOTAL"), Some(0), THRESHOLD_INVALID),
        (Some("SOMETIMES"), Some(2), "Mode d'alerte inconnu"),
    ] {
        let error = categories::set_low_stock(
            &pool,
            &inks,
            LowStockSetting {
                mode: mode.map(Into::into),
                threshold,
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), message);
    }
    let error = product_sheets::create_sheet(
        &pool,
        ProductSheetInput {
            name: "Gants".into(),
            brand: None,
            category_id: None,
            single_use: true,
            after_opening_months: None,
            product_url: None,
            low_stock_threshold: Some(-1),
            expiry_warning_days: None,
        },
        vec![],
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), THRESHOLD_INVALID);

    set(&pool, &inks, Some("TOTAL"), Some(4)).await;
    let tree = categories::list_categories(&pool).await.unwrap();
    assert_eq!(
        (
            tree[0].low_stock_mode.as_deref(),
            tree[0].low_stock_threshold
        ),
        (Some("TOTAL"), Some(4))
    );
    // Pas de mode : le seuil est effacé avec lui.
    set(&pool, &inks, None, Some(4)).await;
    let tree = categories::list_categories(&pool).await.unwrap();
    assert_eq!(
        (
            tree[0].low_stock_mode.as_deref(),
            tree[0].low_stock_threshold
        ),
        (None, None)
    );
}

#[tokio::test]
async fn the_dashboard_and_session_linking_see_the_alert() {
    let pool = db().await;
    let gloves = sheet(&pool, "Gants M", None, Some(10), 12).await;
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

    let linkable = session_usages::list_linkable(&pool, &session.id, None)
        .await
        .unwrap();
    assert_eq!(
        (
            linkable[0].product_name.as_deref(),
            linkable[0].product_stock,
            linkable[0].alert_threshold
        ),
        (Some("Gants M"), Some(12), Some(10))
    );
    assert!(!linkable[0].low_stock);

    let today = chrono::Local::now().date_naive();
    let before = super::dashboard::get_dashboard(&pool, today).await.unwrap();
    assert!(before.alerts.low_stock.sheets.is_empty());
    session_usages::link_session(
        &pool,
        session_usages::LinkSessionInput {
            session_id: session.id,
            lot_id: Some(linkable[0].lot_id.clone()),
            unit_id: None,
            quantity: Some(3),
        },
    )
    .await
    .unwrap();
    let after = super::dashboard::get_dashboard(&pool, today).await.unwrap();
    assert_eq!(after.alerts.low_stock.sheets[0].sheet_id, gloves);
    assert_eq!(after.alerts.low_stock.sheets[0].stock, 9);
}

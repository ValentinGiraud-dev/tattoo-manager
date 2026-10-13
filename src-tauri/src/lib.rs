mod commands;
mod config;
mod database;
pub mod models;
mod services;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = config::init(app.handle())?;
            let pool = database::init(&paths)?;
            app.manage(paths);
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::database_status,
            commands::list_clients,
            commands::get_client,
            commands::create_client,
            commands::update_client,
            commands::list_sessions,
            commands::get_session,
            commands::create_session,
            commands::update_session,
            commands::list_products,
            commands::get_product,
            commands::create_product,
            commands::update_product,
            commands::list_session_products,
            commands::list_product_sessions,
            commands::link_session_product,
            commands::list_linkable_products,
            commands::get_app_paths,
            commands::get_settings,
            commands::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

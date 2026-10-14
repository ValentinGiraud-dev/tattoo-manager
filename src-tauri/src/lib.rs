mod backup;
mod commands;
mod config;
mod database;
pub mod models;
mod services;

use std::fs;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = match config::init(app.handle()) {
                Ok(paths) => paths,
                Err(err) => {
                    show_startup_error(
                        app.handle(),
                        &format!("Tracink n’a pas pu préparer son dossier de données.\n\n{err}"),
                    );
                    return Err(err);
                }
            };

            let version = app.package_info().version.to_string();
            if let Err(err) = backup::copy_if_changed(
                &paths.settings,
                &paths.backups,
                "settings",
                "json",
                &version,
            ) {
                let message = with_report(&paths, &backup::backup_refused_message(&*err));
                show_startup_error(app.handle(), &message);
                return Err(err);
            }

            match database::init(&paths, &version) {
                Ok(pool) => {
                    app.manage(paths);
                    app.manage(pool);
                    Ok(())
                }
                Err(err) => {
                    let message = with_report(&paths, &err.to_string());
                    show_startup_error(app.handle(), &message);
                    Err(err)
                }
            }
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

fn with_report(paths: &config::AppPaths, message: &str) -> String {
    let log_path = paths.root.join("migration-error.log");
    match fs::write(&log_path, message) {
        Ok(()) => format!("{message}\n\nCompte rendu : {}", log_path.display()),
        Err(_) => message.to_string(),
    }
}

fn show_startup_error(app: &tauri::AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title("Tracink")
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

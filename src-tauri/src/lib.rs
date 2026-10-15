mod backup;
mod commands;
mod config;
mod database;
mod external_backup;
pub mod models;
mod security;
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

            // La base est chiffrée : elle n'est ouverte qu'au déverrouillage.
            app.manage(paths);
            app.manage(database::Db::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_security_status,
            commands::setup_security,
            commands::unlock_with_password,
            commands::unlock_with_recovery_key,
            commands::unlock_with_touch_id,
            commands::lock_app,
            commands::change_password,
            commands::renew_recovery_key,
            commands::set_touch_id,
            commands::set_auto_lock,
            commands::run_backup,
            commands::run_backup_if_due,
            commands::set_backup_folder,
            commands::get_backup_settings,
            commands::list_backups,
            commands::restore_backup,
            commands::database_status,
            commands::list_clients,
            commands::get_client,
            commands::create_client,
            commands::update_client,
            commands::list_sessions,
            commands::get_session,
            commands::create_session,
            commands::update_session,
            commands::list_lots,
            commands::get_lot,
            commands::find_lot,
            commands::create_lot,
            commands::update_lot,
            commands::list_lot_units,
            commands::open_unit,
            commands::exit_unit,
            commands::record_lot_movement,
            commands::undo_lot_movement,
            commands::list_lot_movements,
            commands::list_lot_sessions,
            commands::list_session_usages,
            commands::list_linkable_usages,
            commands::link_session_usage,
            commands::void_session_usage,
            commands::list_client_sessions,
            commands::list_client_usages,
            commands::get_session_paperwork,
            commands::save_health_form,
            commands::save_consent_form,
            commands::print_session_form,
            commands::open_aftercare_sheet,
            commands::attach_session_document,
            commands::open_session_document,
            commands::void_session_document,
            commands::list_sessions_between,
            commands::find_session_overlaps,
            commands::list_project_sessions,
            commands::list_client_projects,
            commands::get_project,
            commands::create_project,
            commands::update_project,
            commands::list_project_deposits,
            commands::get_session_billing,
            commands::record_deposit,
            commands::void_deposit,
            commands::apply_deposit,
            commands::settle_deposit,
            commands::void_deposit_outcome,
            commands::record_payment,
            commands::void_payment,
            commands::get_dashboard,
            commands::get_period_summary,
            commands::export_csv,
            commands::get_app_paths,
            commands::get_settings,
            commands::update_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Dernière sauvegarde si quelque chose a changé, puis fermeture propre.
                if let (Some(db), Some(paths)) = (
                    app.try_state::<database::Db>(),
                    app.try_state::<config::AppPaths>(),
                ) {
                    tauri::async_runtime::block_on(commands::on_exit(app, &db, &paths));
                }
            }
        });
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

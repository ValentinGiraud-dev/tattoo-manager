//! Essais de mot de passe ratés, partagés par le déverrouillage et la réinitialisation.
//!
//! Après cinq erreurs d'affilée, chaque nouvel essai attend quelques secondes.

use std::sync::atomic::{AtomicU32, Ordering};

static FAILED_ATTEMPTS: AtomicU32 = AtomicU32::new(0);

pub fn clear_failures() {
    FAILED_ATTEMPTS.store(0, Ordering::Relaxed);
}

pub fn record_failure() {
    FAILED_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
}

pub async fn slow_down() {
    let failures = FAILED_ATTEMPTS.load(Ordering::Relaxed);
    if failures >= 5 {
        let seconds = u64::from((failures - 4).min(6)) * 5;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(std::time::Duration::from_secs(seconds));
        })
        .await;
    }
}

//! Touch ID et Trousseau macOS.
//!
//! Quand Touch ID est activé, une copie de la clé maître est rangée dans le
//! Trousseau de session de l'utilisateur. Le déverrouillage par empreinte demande
//! d'abord Touch ID (LocalAuthentication), puis lit cette copie.
//!
//! Limite assumée : le Trousseau protège la copie par la session macOS, pas par
//! l'empreinte elle-même (les éléments liés à la biométrie exigent une app signée
//! avec un identifiant d'équipe Apple). Le mot de passe de l'app reste la protection
//! de référence ; Touch ID est un confort.

use super::vault::MasterKey;

#[derive(Debug, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum BiometryOutcome {
    Success,
    Cancelled,
    Failed,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{BiometryOutcome, MasterKey};
    use security_framework::passwords;
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};

    const SERVICE: &str = "com.tracink.app";
    const ACCOUNT: &str = "database-key";

    extern "C" {
        fn tracink_biometry_available() -> c_int;
        fn tracink_biometry_authenticate(reason: *const c_char) -> c_int;
    }

    pub fn available() -> bool {
        // SAFETY : fonction C sans argument, sans état partagé.
        unsafe { tracink_biometry_available() == 1 }
    }

    pub fn authenticate(reason: &str) -> BiometryOutcome {
        let Ok(reason) = CString::new(reason) else {
            return BiometryOutcome::Failed;
        };
        // SAFETY : la chaîne vit jusqu'au retour ; l'appel bloque jusqu'à la réponse.
        match unsafe { tracink_biometry_authenticate(reason.as_ptr()) } {
            0 => BiometryOutcome::Success,
            1 => BiometryOutcome::Cancelled,
            _ => BiometryOutcome::Failed,
        }
    }

    pub fn store_key(key: &MasterKey) -> Result<(), String> {
        let hex = key.to_hex();
        let _ = passwords::delete_generic_password(SERVICE, ACCOUNT);
        passwords::set_generic_password(SERVICE, ACCOUNT, hex.as_bytes()).map_err(|error| {
            eprintln!("trousseau : écriture refusée ({})", error.code());
            "Le Trousseau a refusé d'enregistrer la clé.".to_string()
        })
    }

    pub fn load_key() -> Option<MasterKey> {
        let bytes =
            zeroize::Zeroizing::new(passwords::get_generic_password(SERVICE, ACCOUNT).ok()?);
        let text = std::str::from_utf8(&bytes).ok()?;
        MasterKey::from_hex(text)
    }

    pub fn delete_key() {
        let _ = passwords::delete_generic_password(SERVICE, ACCOUNT);
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::{BiometryOutcome, MasterKey};

    pub fn available() -> bool {
        false
    }

    pub fn authenticate(_reason: &str) -> BiometryOutcome {
        BiometryOutcome::Failed
    }

    pub fn store_key(_key: &MasterKey) -> Result<(), String> {
        Err("Touch ID n'est disponible que sur Mac.".to_string())
    }

    pub fn load_key() -> Option<MasterKey> {
        None
    }

    pub fn delete_key() {}
}

pub use imp::{authenticate, available, delete_key, load_key, store_key};

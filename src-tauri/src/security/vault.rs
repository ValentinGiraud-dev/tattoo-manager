//! Coffre de clés : la clé maître qui chiffre la base et les documents.
//!
//! La clé maître (32 octets aléatoires) n'est jamais écrite en clair. `vault.json`
//! en garde deux copies chiffrées (« enveloppes ») :
//! - l'une avec une clé dérivée du mot de passe de l'app (Argon2id) ;
//! - l'autre avec une clé dérivée de la clé de secours, affichée une seule fois.
//!
//! Changer le mot de passe ne réécrit donc que son enveloppe : la base et les
//! documents ne sont pas rechiffrés.

use std::fs;
use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

pub const VAULT_FORMAT: u32 = 1;
pub const MIN_PASSWORD_CHARS: usize = 8;
const AAD: &[u8] = b"tracink-vault-v1";
/// Base32 de Crockford : ni I, ni L, ni O, ni U.
const RECOVERY_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CHARS: usize = 24;

#[derive(Debug, PartialEq, Eq)]
pub enum VaultError {
    /// Mot de passe ou clé de secours incorrects.
    WrongSecret,
    Invalid(&'static str),
    /// `vault.json` illisible ou abîmé.
    Corrupt,
    Io(String),
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongSecret => write!(f, "Mot de passe incorrect."),
            Self::Invalid(message) => write!(f, "{message}"),
            Self::Corrupt => write!(
                f,
                "Le fichier des clés (vault.json) est illisible. Restaurez une sauvegarde."
            ),
            Self::Io(_) => write!(f, "Le fichier des clés n'a pas pu être lu ou écrit."),
        }
    }
}

impl std::error::Error for VaultError {}

fn io_error(error: std::io::Error) -> VaultError {
    eprintln!("coffre : erreur de fichier ({})", error.kind());
    VaultError::Io(error.kind().to_string())
}

/// Clé maître en mémoire. Effacée quand elle est libérée.
#[derive(Clone)]
pub struct MasterKey(Zeroizing<[u8; 32]>);

impl MasterKey {
    pub fn generate() -> Self {
        let mut bytes = Zeroizing::new([0_u8; 32]);
        OsRng.fill_bytes(bytes.as_mut());
        Self(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let array: [u8; 32] = bytes.try_into().ok()?;
        Some(Self(Zeroizing::new(array)))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn to_hex(&self) -> Zeroizing<String> {
        let mut out = String::with_capacity(64);
        for byte in self.0.iter() {
            out.push_str(&format!("{byte:02x}"));
        }
        Zeroizing::new(out)
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub fn from_hex(hex: &str) -> Option<Self> {
        if hex.len() != 64 {
            return None;
        }
        let mut bytes = Zeroizing::new([0_u8; 32]);
        for (index, chunk) in hex.as_bytes().chunks(2).enumerate() {
            let text = std::str::from_utf8(chunk).ok()?;
            bytes[index] = u8::from_str_radix(text, 16).ok()?;
        }
        Some(Self(bytes))
    }

    /// Valeur de `PRAGMA key` pour SQLCipher : clé brute, sans dérivation.
    pub fn sqlcipher_key(&self) -> Zeroizing<String> {
        Zeroizing::new(format!("\"x'{}'\"", self.to_hex().as_str()))
    }
}

impl std::fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MasterKey(…)")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub algorithm: KdfAlgorithm,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KdfAlgorithm {
    Argon2id,
}

impl KdfParams {
    /// Réglages recommandés par l'OWASP pour Argon2id (64 Mio, 3 passes).
    pub const STANDARD: Self = Self {
        algorithm: KdfAlgorithm::Argon2id,
        memory_kib: 65_536,
        iterations: 3,
        parallelism: 1,
    };

    /// Réglages légers, réservés aux tests.
    #[cfg(test)]
    pub const FAST: Self = Self {
        algorithm: KdfAlgorithm::Argon2id,
        memory_kib: 256,
        iterations: 1,
        parallelism: 1,
    };

    fn derive(&self, secret: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, VaultError> {
        let params = Params::new(self.memory_kib, self.iterations, self.parallelism, Some(32))
            .map_err(|_| VaultError::Corrupt)?;
        let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut out = Zeroizing::new([0_u8; 32]);
        argon
            .hash_password_into(secret, salt, out.as_mut())
            .map_err(|_| VaultError::Corrupt)?;
        Ok(out)
    }
}

/// Une copie chiffrée de la clé maître.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeySlot {
    salt: String,
    nonce: String,
    wrapped_key: String,
}

impl KeySlot {
    fn seal(kdf: &KdfParams, secret: &[u8], key: &MasterKey) -> Result<Self, VaultError> {
        let mut salt = [0_u8; 16];
        OsRng.fill_bytes(&mut salt);
        let mut nonce = [0_u8; 24];
        OsRng.fill_bytes(&mut nonce);

        let wrapping = kdf.derive(secret, &salt)?;
        let cipher = XChaCha20Poly1305::new(wrapping.as_ref().into());
        let wrapped = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: key.as_bytes(),
                    aad: AAD,
                },
            )
            .map_err(|_| VaultError::Corrupt)?;

        Ok(Self {
            salt: B64.encode(salt),
            nonce: B64.encode(nonce),
            wrapped_key: B64.encode(wrapped),
        })
    }

    fn open(&self, kdf: &KdfParams, secret: &[u8]) -> Result<MasterKey, VaultError> {
        let salt = B64.decode(&self.salt).map_err(|_| VaultError::Corrupt)?;
        let nonce = B64.decode(&self.nonce).map_err(|_| VaultError::Corrupt)?;
        let wrapped = B64
            .decode(&self.wrapped_key)
            .map_err(|_| VaultError::Corrupt)?;
        if nonce.len() != 24 || salt.len() < 16 {
            return Err(VaultError::Corrupt);
        }

        let wrapping = kdf.derive(secret, &salt)?;
        let cipher = XChaCha20Poly1305::new(wrapping.as_ref().into());
        let mut plain = cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &wrapped,
                    aad: AAD,
                },
            )
            .map_err(|_| VaultError::WrongSecret)?;
        let key = MasterKey::from_bytes(&plain).ok_or(VaultError::Corrupt);
        plain.zeroize();
        key
    }
}

/// Contenu de `vault.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub format: u32,
    pub kdf: KdfParams,
    password: KeySlot,
    recovery: KeySlot,
    pub created_at: String,
    pub password_changed_at: String,
}

/// Clé de secours à montrer une seule fois, au format `XXXX-XXXX-…`.
pub struct RecoveryKey(Zeroizing<String>);

impl RecoveryKey {
    fn generate() -> Self {
        let mut raw = Zeroizing::new([0_u8; RECOVERY_CHARS]);
        OsRng.fill_bytes(raw.as_mut());
        let mut text = String::with_capacity(RECOVERY_CHARS + RECOVERY_CHARS / 4);
        for (index, byte) in raw.iter().enumerate() {
            if index > 0 && index % 4 == 0 {
                text.push('-');
            }
            text.push(RECOVERY_ALPHABET[usize::from(byte & 31)] as char);
        }
        Self(Zeroizing::new(text))
    }

    pub fn display(&self) -> &str {
        &self.0
    }
}

/// Forme canonique d'une clé de secours saisie : majuscules, sans tirets ni espaces,
/// avec les confusions courantes corrigées (O → 0, I et L → 1).
pub fn normalize_recovery(input: &str) -> Result<Zeroizing<String>, VaultError> {
    let mut out = Zeroizing::new(String::with_capacity(RECOVERY_CHARS));
    for character in input.chars() {
        if character == '-' || character.is_whitespace() {
            continue;
        }
        let upper = match character.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        };
        if !upper.is_ascii() || !RECOVERY_ALPHABET.contains(&(upper as u8)) {
            return Err(VaultError::Invalid(
                "La clé de secours contient un caractère inattendu.",
            ));
        }
        out.push(upper);
    }
    if out.len() != RECOVERY_CHARS {
        return Err(VaultError::Invalid(
            "La clé de secours compte 24 caractères (6 groupes de 4).",
        ));
    }
    Ok(out)
}

pub fn check_new_password(password: &str) -> Result<(), VaultError> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(VaultError::Invalid(
            "Le mot de passe doit compter au moins 8 caractères.",
        ));
    }
    if password.trim().is_empty() {
        return Err(VaultError::Invalid(
            "Le mot de passe ne peut pas être fait que d'espaces.",
        ));
    }
    Ok(())
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}

impl Vault {
    /// Crée un coffre neuf : nouvelle clé maître, mot de passe, clé de secours.
    pub fn create(
        password: &str,
        kdf: KdfParams,
    ) -> Result<(Self, MasterKey, RecoveryKey), VaultError> {
        let key = MasterKey::generate();
        let (vault, recovery) = Self::create_with_key(password, kdf, &key)?;
        Ok((vault, key, recovery))
    }

    /// Coffre neuf pour une clé maître donnée (rotation de la clé) : nouveau mot de
    /// passe et nouvelle clé de secours.
    pub fn create_with_key(
        password: &str,
        kdf: KdfParams,
        key: &MasterKey,
    ) -> Result<(Self, RecoveryKey), VaultError> {
        check_new_password(password)?;
        let recovery = RecoveryKey::generate();
        let canonical = normalize_recovery(recovery.display())?;
        let created_at = now();
        let vault = Self {
            format: VAULT_FORMAT,
            kdf,
            password: KeySlot::seal(&kdf, password.as_bytes(), key)?,
            recovery: KeySlot::seal(&kdf, canonical.as_bytes(), key)?,
            password_changed_at: created_at.clone(),
            created_at,
        };
        Ok((vault, recovery))
    }

    pub fn unlock_with_password(&self, password: &str) -> Result<MasterKey, VaultError> {
        self.password.open(&self.kdf, password.as_bytes())
    }

    pub fn unlock_with_recovery(&self, recovery: &str) -> Result<MasterKey, VaultError> {
        let canonical = normalize_recovery(recovery)?;
        self.recovery
            .open(&self.kdf, canonical.as_bytes())
            .map_err(|error| match error {
                VaultError::WrongSecret => VaultError::Invalid("Clé de secours incorrecte."),
                other => other,
            })
    }

    /// Remplace le mot de passe. La clé maître ne change pas.
    pub fn set_password(&mut self, key: &MasterKey, password: &str) -> Result<(), VaultError> {
        check_new_password(password)?;
        self.password = KeySlot::seal(&self.kdf, password.as_bytes(), key)?;
        self.password_changed_at = now();
        Ok(())
    }

    /// Crée une nouvelle clé de secours ; l'ancienne ne fonctionne plus.
    pub fn renew_recovery(&mut self, key: &MasterKey) -> Result<RecoveryKey, VaultError> {
        let recovery = RecoveryKey::generate();
        let canonical = normalize_recovery(recovery.display())?;
        self.recovery = KeySlot::seal(&self.kdf, canonical.as_bytes(), key)?;
        Ok(recovery)
    }

    pub fn load(path: &Path) -> Result<Self, VaultError> {
        let text = fs::read_to_string(path).map_err(io_error)?;
        let vault: Self = serde_json::from_str(&text).map_err(|_| VaultError::Corrupt)?;
        if vault.format != VAULT_FORMAT {
            return Err(VaultError::Invalid(
                "Ce coffre a été créé par une version plus récente de Tracink.",
            ));
        }
        Ok(vault)
    }

    /// Écriture atomique : fichier temporaire, synchronisation, puis renommage.
    pub fn save(&self, path: &Path) -> Result<(), VaultError> {
        let text = serde_json::to_string_pretty(self).map_err(|_| VaultError::Corrupt)?;
        write_atomic(path, text.as_bytes()).map_err(io_error)
    }
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp-write");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tracink-vault-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn password_and_recovery_open_the_same_key() {
        let (vault, key, recovery) = Vault::create("correct horse", KdfParams::FAST).unwrap();
        let by_password = vault.unlock_with_password("correct horse").unwrap();
        let by_recovery = vault.unlock_with_recovery(recovery.display()).unwrap();
        assert_eq!(by_password.as_bytes(), key.as_bytes());
        assert_eq!(by_recovery.as_bytes(), key.as_bytes());
    }

    #[test]
    fn wrong_password_is_refused() {
        let (vault, _, _) = Vault::create("correct horse", KdfParams::FAST).unwrap();
        assert_eq!(
            vault.unlock_with_password("Correct horse").unwrap_err(),
            VaultError::WrongSecret
        );
    }

    #[test]
    fn short_password_is_refused() {
        assert!(matches!(
            Vault::create("1234567", KdfParams::FAST),
            Err(VaultError::Invalid(_))
        ));
        assert!(matches!(
            Vault::create("        ", KdfParams::FAST),
            Err(VaultError::Invalid(_))
        ));
    }

    #[test]
    fn recovery_key_is_forgiving_about_format() {
        let (vault, key, recovery) = Vault::create("correct horse", KdfParams::FAST).unwrap();
        let shown = recovery.display().to_string();
        assert_eq!(shown.len(), 29);
        assert_eq!(shown.matches('-').count(), 5);

        let typed = shown.to_lowercase().replace('-', " ").replace('0', "o");
        let opened = vault.unlock_with_recovery(&typed).unwrap();
        assert_eq!(opened.as_bytes(), key.as_bytes());
    }

    #[test]
    fn wrong_recovery_key_is_refused() {
        let (vault, _, _) = Vault::create("correct horse", KdfParams::FAST).unwrap();
        assert!(matches!(
            vault.unlock_with_recovery("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA"),
            Err(VaultError::Invalid("Clé de secours incorrecte."))
        ));
        assert!(matches!(
            vault.unlock_with_recovery("AAAA-AAAA"),
            Err(VaultError::Invalid(_))
        ));
        assert!(matches!(
            vault.unlock_with_recovery("AAAA-AAAA-AAAA-AAAA-AAAA-AAA#"),
            Err(VaultError::Invalid(_))
        ));
    }

    #[test]
    fn changing_password_keeps_the_key_and_drops_the_old_password() {
        let (mut vault, key, recovery) = Vault::create("first password", KdfParams::FAST).unwrap();
        vault.set_password(&key, "second password").unwrap();
        assert_eq!(
            vault.unlock_with_password("first password").unwrap_err(),
            VaultError::WrongSecret
        );
        let opened = vault.unlock_with_password("second password").unwrap();
        assert_eq!(opened.as_bytes(), key.as_bytes());
        // La clé de secours reste valable.
        assert!(vault.unlock_with_recovery(recovery.display()).is_ok());
    }

    #[test]
    fn renewing_recovery_key_revokes_the_old_one() {
        let (mut vault, key, old) = Vault::create("first password", KdfParams::FAST).unwrap();
        let new = vault.renew_recovery(&key).unwrap();
        assert!(vault.unlock_with_recovery(old.display()).is_err());
        assert!(vault.unlock_with_recovery(new.display()).is_ok());
    }

    #[test]
    fn vault_survives_a_save_and_load() {
        let dir = temp_dir("save");
        let path = dir.join("vault.json");
        let (vault, key, _) = Vault::create("correct horse", KdfParams::FAST).unwrap();
        vault.save(&path).unwrap();
        assert!(!dir.join("vault.tmp-write").exists());

        let loaded = Vault::load(&path).unwrap();
        assert_eq!(loaded, vault);
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains(key.to_hex().as_str()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn tampered_vault_is_refused() {
        let (mut vault, _, _) = Vault::create("correct horse", KdfParams::FAST).unwrap();
        vault.password.wrapped_key = B64.encode([0_u8; 48]);
        assert_eq!(
            vault.unlock_with_password("correct horse").unwrap_err(),
            VaultError::WrongSecret
        );
        vault.password.nonce = "pas du base64".into();
        assert_eq!(
            vault.unlock_with_password("correct horse").unwrap_err(),
            VaultError::Corrupt
        );
    }

    #[test]
    fn master_key_hex_roundtrip() {
        let key = MasterKey::generate();
        let back = MasterKey::from_hex(&key.to_hex()).unwrap();
        assert_eq!(back.as_bytes(), key.as_bytes());
        assert!(MasterKey::from_hex("zz").is_none());
        assert!(key.sqlcipher_key().starts_with("\"x'"));
    }
}

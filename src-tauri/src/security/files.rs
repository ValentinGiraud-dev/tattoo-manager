//! Chiffrement des fichiers rangés par l'app (scans signés, photos).
//!
//! Format : `TRACINK-ENC1\n` + nonce (24 octets) + données chiffrées
//! XChaCha20-Poly1305 (l'en-tête sert de données associées). Un fichier abîmé ou
//! chiffré avec une autre clé est refusé au lieu de produire un document faux.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use super::vault::{write_atomic, MasterKey};

pub const MAGIC: &[u8] = b"TRACINK-ENC1\n";
const NONCE_LEN: usize = 24;

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// Clé propre aux fichiers, distincte de celle de la base (même clé maître).
fn file_cipher(key: &MasterKey) -> XChaCha20Poly1305 {
    use blake2::digest::{Mac, Update};
    let mut mac = blake2::Blake2bMac::<blake2::digest::consts::U32>::new_with_salt_and_personal(
        key.as_bytes(),
        &[],
        b"tracink-files",
    )
    .expect("clé de 32 octets acceptée par Blake2b");
    Update::update(&mut mac, b"documents-v1");
    let derived = mac.finalize().into_bytes();
    XChaCha20Poly1305::new(&derived)
}

pub fn is_encrypted_bytes(bytes: &[u8]) -> bool {
    bytes.starts_with(MAGIC)
}

pub fn is_encrypted_file(path: &Path) -> io::Result<bool> {
    use std::io::Read;
    let mut head = [0_u8; 13];
    let mut file = fs::File::open(path)?;
    let mut filled = 0;
    while filled < head.len() {
        match file.read(&mut head[filled..])? {
            0 => break,
            read => filled += read,
        }
    }
    Ok(is_encrypted_bytes(&head[..filled]))
}

pub fn encrypt_bytes(key: &MasterKey, plain: &[u8]) -> io::Result<Vec<u8>> {
    let mut nonce = [0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let sealed = file_cipher(key)
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: MAGIC,
            },
        )
        .map_err(|_| invalid("chiffrement impossible"))?;
    let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + sealed.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    Ok(out)
}

pub fn decrypt_bytes(key: &MasterKey, data: &[u8]) -> io::Result<Vec<u8>> {
    if !is_encrypted_bytes(data) || data.len() < MAGIC.len() + NONCE_LEN {
        return Err(invalid("fichier non chiffré par Tracink"));
    }
    let nonce = &data[MAGIC.len()..MAGIC.len() + NONCE_LEN];
    file_cipher(key)
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: &data[MAGIC.len() + NONCE_LEN..],
                aad: MAGIC,
            },
        )
        .map_err(|_| invalid("fichier abîmé ou clé différente"))
}

/// Chiffre `source` (fichier en clair choisi par l'utilisateur) vers `destination`.
pub fn encrypt_file_to(key: &MasterKey, source: &Path, destination: &Path) -> io::Result<()> {
    let plain = fs::read(source)?;
    write_atomic(destination, &encrypt_bytes(key, &plain)?)
}

pub fn decrypt_file(key: &MasterKey, path: &Path) -> io::Result<Vec<u8>> {
    decrypt_bytes(key, &fs::read(path)?)
}

/// Chiffre sur place un fichier resté en clair. Sans effet s'il l'est déjà.
pub fn encrypt_in_place(key: &MasterKey, path: &Path) -> io::Result<bool> {
    if is_encrypted_file(path)? {
        return Ok(false);
    }
    let plain = fs::read(path)?;
    write_atomic(path, &encrypt_bytes(key, &plain)?)?;
    Ok(true)
}

/// Chiffre tous les fichiers en clair d'un dossier, sous-dossiers compris.
/// Renvoie le nombre de fichiers chiffrés.
pub fn encrypt_tree(key: &MasterKey, root: &Path) -> io::Result<usize> {
    let mut count = 0;
    for path in list_files(root)? {
        if encrypt_in_place(key, &path)? {
            count += 1;
        }
    }
    Ok(count)
}

pub fn list_files(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if !root.exists() {
        return Ok(files);
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let path = entry.path();
            if kind.is_dir() {
                stack.push(path);
            } else if kind.is_file() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                // Fichiers système et écritures interrompues.
                if name == ".DS_Store" || name.ends_with(".tmp-write") {
                    continue;
                }
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tracink-files-{name}-{}-{}",
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
    fn roundtrip_and_wrong_key() {
        let key = MasterKey::generate();
        let sealed = encrypt_bytes(&key, b"scan du consentement").unwrap();
        assert!(is_encrypted_bytes(&sealed));
        assert!(!sealed
            .windows(8)
            .any(|window| window == b"scan du ".as_slice()));
        assert_eq!(
            decrypt_bytes(&key, &sealed).unwrap(),
            b"scan du consentement"
        );
        assert!(decrypt_bytes(&MasterKey::generate(), &sealed).is_err());
    }

    #[test]
    fn tampered_file_is_refused() {
        let key = MasterKey::generate();
        let mut sealed = encrypt_bytes(&key, b"contenu").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert!(decrypt_bytes(&key, &sealed).is_err());
        assert!(decrypt_bytes(&key, b"%PDF-1.7 en clair").is_err());
    }

    #[test]
    fn encrypt_tree_is_idempotent() {
        let key = MasterKey::generate();
        let root = temp_dir("tree");
        fs::create_dir_all(root.join("s1/a-imprimer")).unwrap();
        fs::write(root.join("s1/scan.pdf"), b"%PDF scan").unwrap();
        fs::write(root.join("s1/a-imprimer/form.pdf"), b"%PDF form").unwrap();
        fs::write(root.join(".DS_Store"), b"mac").unwrap();

        assert_eq!(encrypt_tree(&key, &root).unwrap(), 2);
        assert_eq!(encrypt_tree(&key, &root).unwrap(), 0);
        assert_eq!(
            decrypt_file(&key, &root.join("s1/scan.pdf")).unwrap(),
            b"%PDF scan"
        );
        assert_eq!(fs::read(root.join(".DS_Store")).unwrap(), b"mac");
        let _ = fs::remove_dir_all(root);
    }
}

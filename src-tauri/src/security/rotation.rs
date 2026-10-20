//! Rotation de la clé maître : tout est rechiffré avec une nouvelle clé, sous un
//! nouveau mot de passe et une nouvelle clé de secours.
//!
//! À faire si le mot de passe ou la clé de secours ont pu fuiter avec une copie des
//! données : l'ancienne clé ne doit plus rien ouvrir de ce qui est sur ce Mac.
//!
//! Sûreté en cas de coupure (app fermée, Mac éteint) :
//! 1. `start` vérifie que tout s'ouvre avec l'ancienne clé, puis écrit le journal
//!    `rotation.json` : le nouveau coffre, la nouvelle clé chiffrée par l'ancienne et
//!    l'ancienne chiffrée par la nouvelle. Rien d'autre n'a changé.
//! 2. `resume` rechiffre chaque élément s'il ne l'est pas déjà (base, documents,
//!    photos, copies automatiques), puis remplace `vault.json` par le nouveau coffre,
//!    et seulement alors efface le journal et l'ancienne base.
//!
//! `resume` est appelé à chaque déverrouillage : tant que le journal existe, l'ancien
//! comme le nouveau mot de passe (ou clé de secours) ouvrent l'app, et la rotation se
//! termine. Chaque étape peut être rejouée sans dommage.
//!
//! Les sauvegardes externes déjà faites ne sont pas modifiées : elles gardent leur
//! propre coffre et s'ouvrent toujours avec l'ancien mot de passe ou l'ancienne clé
//! de secours. Une nouvelle sauvegarde est faite juste après la rotation.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};

use super::files;
use super::vault::{write_atomic, MasterKey, Vault};
use crate::config::AppPaths;
use crate::database::{self, OpenError};

pub const JOURNAL_FORMAT: u32 = 1;
const AAD: &[u8] = b"tracink-rotation-v1";

#[derive(Debug)]
pub enum RotationError {
    /// Un élément ne s'ouvre pas avec la clé actuelle : rien n'a été commencé.
    Unreadable(&'static str),
    /// La clé fournie n'est ni l'ancienne ni la nouvelle.
    WrongKey,
    Failed(String),
}

impl std::fmt::Display for RotationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreadable(what) => write!(
                f,
                "{what} ne s'ouvre pas avec la clé actuelle : rotation annulée, rien n'a été modifié."
            ),
            Self::WrongKey => write!(
                f,
                "Ce mot de passe ne correspond pas au rechiffrement en cours."
            ),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for RotationError {}

impl From<RotationError> for OpenError {
    fn from(error: RotationError) -> Self {
        match error {
            RotationError::WrongKey => OpenError::WrongKey,
            other => OpenError::Failed(format!(
                "Le rechiffrement des données n'a pas pu se terminer : {other} Déverrouille à nouveau Tracink pour le reprendre (ancien ou nouveau mot de passe)."
            )),
        }
    }
}

fn failed(step: &str, error: impl std::fmt::Display) -> RotationError {
    // Ni chemin, ni clé : l'étape et l'erreur technique.
    eprintln!("rotation : {step} ({error})");
    RotationError::Failed(format!("Étape « {step} » interrompue."))
}

/// Une clé maître chiffrée par une autre (pour retrouver l'une à partir de l'autre).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedKey {
    nonce: String,
    data: String,
}

fn wrapping_cipher(key: &MasterKey) -> XChaCha20Poly1305 {
    use blake2::digest::{Mac, Update};
    let mut mac = blake2::Blake2bMac::<blake2::digest::consts::U32>::new_with_salt_and_personal(
        key.as_bytes(),
        &[],
        b"tracink-rotate",
    )
    .expect("clé de 32 octets acceptée par Blake2b");
    Update::update(&mut mac, b"wrap-v1");
    XChaCha20Poly1305::new(&mac.finalize().into_bytes())
}

impl WrappedKey {
    fn seal(wrapping: &MasterKey, key: &MasterKey) -> Result<Self, RotationError> {
        let mut nonce = [0_u8; 24];
        OsRng.fill_bytes(&mut nonce);
        let data = wrapping_cipher(wrapping)
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: key.as_bytes(),
                    aad: AAD,
                },
            )
            .map_err(|_| failed("préparation", "chiffrement de la clé"))?;
        Ok(Self {
            nonce: B64.encode(nonce),
            data: B64.encode(data),
        })
    }

    fn open(&self, wrapping: &MasterKey) -> Option<MasterKey> {
        let nonce = B64.decode(&self.nonce).ok()?;
        let data = B64.decode(&self.data).ok()?;
        if nonce.len() != 24 {
            return None;
        }
        let plain = zeroize::Zeroizing::new(
            wrapping_cipher(wrapping)
                .decrypt(
                    XNonce::from_slice(&nonce),
                    Payload {
                        msg: &data,
                        aad: AAD,
                    },
                )
                .ok()?,
        );
        MasterKey::from_bytes(&plain)
    }
}

/// Contenu de `rotation.json`. Aucune clé n'y est en clair.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub format: u32,
    pub started_at: String,
    /// Coffre final : nouveau mot de passe et nouvelle clé de secours.
    pub new_vault: Vault,
    new_by_old: WrappedKey,
    old_by_new: WrappedKey,
}

impl Journal {
    /// (ancienne, nouvelle) à partir de l'une des deux ; `None` pour une autre clé.
    fn keys(&self, key: &MasterKey) -> Option<(MasterKey, MasterKey)> {
        if let Some(new) = self.new_by_old.open(key) {
            return Some((key.clone(), new));
        }
        self.old_by_new.open(key).map(|old| (old, key.clone()))
    }
}

pub fn journal_path(paths: &AppPaths) -> PathBuf {
    paths.root.join("rotation.json")
}

fn previous_database(paths: &AppPaths) -> PathBuf {
    paths.root.join("database.pre-rotation")
}

fn rekeyed_database(paths: &AppPaths) -> PathBuf {
    paths.root.join("database.rekeyed")
}

pub fn is_pending(paths: &AppPaths) -> bool {
    journal_path(paths).exists()
}

pub fn load_journal(paths: &AppPaths) -> Result<Option<Journal>, RotationError> {
    let path = journal_path(paths);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|error| failed("lecture du journal", error))?;
    let journal: Journal =
        serde_json::from_str(&text).map_err(|error| failed("lecture du journal", error))?;
    if journal.format != JOURNAL_FORMAT {
        return Err(RotationError::Failed(
            "Ce rechiffrement a été commencé par une autre version de Tracink.".into(),
        ));
    }
    Ok(Some(journal))
}

/// Coffre final d'une rotation en cours : il ouvre l'app avec le nouveau mot de passe.
pub fn pending_vault(paths: &AppPaths) -> Option<Vault> {
    load_journal(paths)
        .ok()
        .flatten()
        .map(|journal| journal.new_vault)
}

/// Vérifie que tout s'ouvre avec la clé actuelle, puis écrit le journal. Ne modifie
/// aucune donnée. `new_vault` est le coffre de `new_key` (nouveau mot de passe).
pub async fn start(
    paths: &AppPaths,
    old_key: &MasterKey,
    new_key: &MasterKey,
    new_vault: Vault,
) -> Result<(), RotationError> {
    if is_pending(paths) {
        return Err(RotationError::Failed(
            "Un rechiffrement est déjà en cours.".into(),
        ));
    }
    if paths.database.exists() {
        database::inspect_encrypted(&paths.database, old_key)
            .await
            .map_err(|_| RotationError::Unreadable("La base de données"))?;
    }
    for (root, what) in [
        (&paths.documents, "Un document joint"),
        (&paths.photos, "Une photo"),
    ] {
        for file in files::list_files(root).map_err(|error| failed("lecture", error))? {
            files::decrypt_file(old_key, &file).map_err(|_| RotationError::Unreadable(what))?;
        }
    }

    let journal = Journal {
        format: JOURNAL_FORMAT,
        started_at: chrono::Local::now().to_rfc3339(),
        new_vault,
        new_by_old: WrappedKey::seal(old_key, new_key)?,
        old_by_new: WrappedKey::seal(new_key, old_key)?,
    };
    let text = serde_json::to_string_pretty(&journal).map_err(|error| failed("journal", error))?;
    write_atomic(&journal_path(paths), text.as_bytes()).map_err(|error| failed("journal", error))
}

/// Termine une rotation en cours (ou ne fait rien s'il n'y en a pas). `key` est
/// l'ancienne ou la nouvelle clé ; renvoie la clé à utiliser désormais.
pub async fn resume(paths: &AppPaths, key: MasterKey) -> Result<MasterKey, RotationError> {
    let Some(journal) = load_journal(paths)? else {
        return Ok(key);
    };
    let (old, new) = journal.keys(&key).ok_or(RotationError::WrongKey)?;

    rekey_database(paths, &old, &new).await?;
    let mut skipped = 0;
    for root in [&paths.documents, &paths.photos] {
        skipped += rekey_tree(root, &old, &new)?;
    }
    rekey_local_backups(&paths.backups, &old, &new).await?;
    if skipped > 0 {
        eprintln!("rotation : {skipped} fichier(s) illisible(s) laissé(s) tel(s) quel(s)");
    }

    // Les données sont toutes sous la nouvelle clé : le nouveau coffre prend la place.
    journal
        .new_vault
        .save(&paths.vault)
        .map_err(|error| failed("coffre", error))?;
    database::remove_with_sidecars(&previous_database(paths))
        .map_err(|error| failed("nettoyage", error))?;
    fs::remove_file(journal_path(paths)).map_err(|error| failed("nettoyage", error))?;
    Ok(new)
}

/// Vrai si la base s'ouvre et est intègre avec cette clé.
async fn opens_with(path: &Path, key: &MasterKey) -> Result<bool, RotationError> {
    match database::inspect_encrypted(path, key).await {
        Ok(_) => Ok(true),
        Err(OpenError::WrongKey) => Ok(false),
        Err(error) => Err(failed("contrôle de la base", error)),
    }
}

/// Base : copie vérifiée sous la nouvelle clé, puis échange des fichiers.
/// L'ancienne base est gardée (`database.pre-rotation`) jusqu'à la fin.
async fn rekey_database(
    paths: &AppPaths,
    old: &MasterKey,
    new: &MasterKey,
) -> Result<(), RotationError> {
    let database = &paths.database;
    let rekeyed = rekeyed_database(paths);
    let previous = previous_database(paths);
    let rename = |from: &Path, to: &Path| {
        database::move_with_sidecars(from, to).map_err(|error| failed("échange de la base", error))
    };

    // Coupure entre les deux renommages.
    if !database.exists() && rekeyed.exists() {
        rename(&rekeyed, database)?;
    }
    if !database.exists() && previous.exists() {
        rename(&previous, database)?;
    }
    if !database.exists() || opens_with(database, new).await? {
        database::remove_with_sidecars(&rekeyed).map_err(|error| failed("nettoyage", error))?;
        return Ok(());
    }

    database::export_with_key(database, Some(old), &rekeyed, new)
        .await
        .map_err(|error| failed("rechiffrement de la base", error))?;
    rename(database, &previous)?;
    rename(&rekeyed, database)?;
    Ok(())
}

/// Documents et photos : chaque fichier encore sous l'ancienne clé est rechiffré
/// (écriture atomique). Renvoie le nombre de fichiers illisibles laissés tels quels.
fn rekey_tree(root: &Path, old: &MasterKey, new: &MasterKey) -> Result<usize, RotationError> {
    let mut skipped = 0;
    for file in files::list_files(root).map_err(|error| failed("lecture des fichiers", error))? {
        let data = fs::read(&file).map_err(|error| failed("lecture des fichiers", error))?;
        if files::decrypt_bytes(new, &data).is_ok() {
            continue;
        }
        match files::decrypt_bytes(old, &data) {
            Ok(plain) => {
                let sealed = files::encrypt_bytes(new, &plain)
                    .map_err(|error| failed("rechiffrement des fichiers", error))?;
                write_atomic(&file, &sealed)
                    .map_err(|error| failed("rechiffrement des fichiers", error))?;
            }
            Err(_) => skipped += 1,
        }
    }
    Ok(skipped)
}

/// Copies automatiques de la base (`backups/database-*.sqlite`).
async fn rekey_local_backups(
    backups: &Path,
    old: &MasterKey,
    new: &MasterKey,
) -> Result<(), RotationError> {
    let Ok(entries) = fs::read_dir(backups) else {
        return Ok(());
    };
    let mut copies: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("database-") && name.ends_with(".sqlite"))
        })
        .collect();
    copies.sort();
    for copy in copies {
        if opens_with(&copy, new).await.unwrap_or(false) {
            continue;
        }
        if !opens_with(&copy, old).await.unwrap_or(false) {
            eprintln!("rotation : une copie automatique illisible est laissée telle quelle");
            continue;
        }
        let tmp = copy.with_extension("rekeying");
        database::export_with_key(&copy, Some(old), &tmp, new)
            .await
            .map_err(|error| failed("copies automatiques", error))?;
        fs::rename(&tmp, &copy).map_err(|error: io::Error| failed("copies automatiques", error))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;

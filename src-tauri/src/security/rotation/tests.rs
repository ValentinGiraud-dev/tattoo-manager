//! Rotation de la clé maître : tout passe sous la nouvelle clé, l'ancienne n'ouvre
//! plus rien, et une coupure à n'importe quelle étape se reprend.

use std::fs;
use std::path::PathBuf;

use sqlx::SqlitePool;

use super::*;
use crate::security::vault::KdfParams;

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tracink-rotation-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn paths(&self) -> AppPaths {
        let paths = AppPaths::under(self.0.join("data"), self.0.join("ouverts"));
        for dir in [&paths.root, &paths.documents, &paths.photos, &paths.backups] {
            fs::create_dir_all(dir).unwrap();
        }
        paths
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const OLD_PASSWORD: &str = "ancien mot de passe";
const NEW_PASSWORD: &str = "nouveau mot de passe";

/// Données d'une installation : coffre, base avec une cliente, un scan, une photo,
/// une copie automatique. Renvoie la clé et la clé de secours.
async fn install(paths: &AppPaths) -> (MasterKey, String) {
    let (vault, key, recovery) = Vault::create(OLD_PASSWORD, KdfParams::FAST).unwrap();
    vault.save(&paths.vault).unwrap();
    let pool = database::open(paths, &key, "test").await.unwrap();
    sqlx::query(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Alice', 'Martin', '2026-01-01', '2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();
    crate::backup::snapshot_database(&pool, &paths.backups, "test")
        .await
        .unwrap();
    pool.close().await;
    fs::create_dir_all(paths.documents.join("s1")).unwrap();
    fs::write(
        paths.documents.join("s1/scan.pdf"),
        files::encrypt_bytes(&key, b"%PDF consentement").unwrap(),
    )
    .unwrap();
    fs::write(
        paths.photos.join("bras.jpg"),
        files::encrypt_bytes(&key, b"JPEG bras").unwrap(),
    )
    .unwrap();
    (key, recovery.display().to_string())
}

/// Prépare la rotation comme le fait la commande : nouveau coffre, journal.
async fn prepare(paths: &AppPaths, old: &MasterKey) -> (MasterKey, String) {
    let new = MasterKey::generate();
    let (vault, recovery) = Vault::create_with_key(NEW_PASSWORD, KdfParams::FAST, &new).unwrap();
    start(paths, old, &new, vault).await.unwrap();
    (new, recovery.display().to_string())
}

async fn clients(paths: &AppPaths, key: &MasterKey) -> Vec<String> {
    let pool: SqlitePool = database::connect_encrypted(&paths.database, key, false)
        .await
        .unwrap();
    let names = sqlx::query_scalar("SELECT first_name FROM clients")
        .fetch_all(&pool)
        .await
        .unwrap();
    pool.close().await;
    names
}

fn local_copies(paths: &AppPaths) -> Vec<PathBuf> {
    fs::read_dir(&paths.backups)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sqlite"))
        .collect()
}

/// Vérifie qu'à la fin tout est sous `new`, et que `old` n'ouvre plus rien.
async fn assert_rotated(paths: &AppPaths, old: &MasterKey, new: &MasterKey) {
    assert_eq!(clients(paths, new).await, ["Alice"]);
    assert!(matches!(
        database::inspect_encrypted(&paths.database, old).await,
        Err(OpenError::WrongKey)
    ));
    let scan = paths.documents.join("s1/scan.pdf");
    assert_eq!(
        files::decrypt_file(new, &scan).unwrap(),
        b"%PDF consentement"
    );
    assert!(files::decrypt_file(old, &scan).is_err());
    assert_eq!(
        files::decrypt_file(new, &paths.photos.join("bras.jpg")).unwrap(),
        b"JPEG bras"
    );
    let copies = local_copies(paths);
    assert!(!copies.is_empty());
    for copy in copies {
        database::inspect_encrypted(&copy, new).await.unwrap();
    }
    assert!(!is_pending(paths));
    assert!(!previous_database(paths).exists());
    assert!(!rekeyed_database(paths).exists());
}

#[tokio::test]
async fn everything_moves_to_the_new_key_and_the_old_secrets_stop_working() {
    let dir = TempDir::new("full");
    let paths = dir.paths();
    let (old, old_recovery) = install(&paths).await;
    let (new, new_recovery) = prepare(&paths, &old).await;

    // Rien n'a changé tant que la reprise n'a pas tourné.
    assert_eq!(clients(&paths, &old).await, ["Alice"]);

    let final_key = resume(&paths, old.clone()).await.unwrap();
    assert_eq!(final_key.as_bytes(), new.as_bytes());
    assert_rotated(&paths, &old, &new).await;

    let vault = Vault::load(&paths.vault).unwrap();
    assert_eq!(
        vault.unlock_with_password(NEW_PASSWORD).unwrap().as_bytes(),
        new.as_bytes()
    );
    assert!(vault.unlock_with_password(OLD_PASSWORD).is_err());
    assert!(vault.unlock_with_recovery(&old_recovery).is_err());
    assert!(vault.unlock_with_recovery(&new_recovery).is_ok());

    // Le déverrouillage suivant ouvre l'app normalement.
    let pool = database::open(&paths, &new, "test").await.unwrap();
    pool.close().await;
}

#[tokio::test]
async fn an_interrupted_rotation_resumes_with_the_old_or_the_new_password() {
    let dir = TempDir::new("resume");
    let paths = dir.paths();
    let (old, _) = install(&paths).await;
    let (new, _) = prepare(&paths, &old).await;

    // Coupure : la photo est déjà rechiffrée, la base est échangée à moitié
    // (copie rechiffrée prête, base actuelle déjà mise de côté).
    let photo = paths.photos.join("bras.jpg");
    fs::write(&photo, files::encrypt_bytes(&new, b"JPEG bras").unwrap()).unwrap();
    database::export_with_key(&paths.database, Some(&old), &rekeyed_database(&paths), &new)
        .await
        .unwrap();
    database::move_with_sidecars(&paths.database, &previous_database(&paths)).unwrap();
    assert!(!paths.database.exists());

    // L'utilisatrice saisit le nouveau mot de passe : le coffre en cours l'accepte.
    assert!(Vault::load(&paths.vault)
        .unwrap()
        .unlock_with_password(NEW_PASSWORD)
        .is_err());
    let typed = pending_vault(&paths)
        .unwrap()
        .unlock_with_password(NEW_PASSWORD)
        .unwrap();
    let final_key = resume(&paths, typed).await.unwrap();
    assert_eq!(final_key.as_bytes(), new.as_bytes());
    assert_rotated(&paths, &old, &new).await;

    // Rejouer la reprise une fois terminée ne fait rien.
    let again = resume(&paths, new.clone()).await.unwrap();
    assert_eq!(again.as_bytes(), new.as_bytes());
}

#[tokio::test]
async fn a_crash_after_the_new_vault_is_written_still_cleans_up() {
    let dir = TempDir::new("after-vault");
    let paths = dir.paths();
    let (old, _) = install(&paths).await;
    let (new, _) = prepare(&paths, &old).await;
    // Toutes les données rechiffrées et le coffre remplacé, journal pas encore effacé.
    let journal = load_journal(&paths).unwrap().unwrap();
    rekey_database(&paths, &old, &new).await.unwrap();
    rekey_tree(&paths.documents, &old, &new).unwrap();
    rekey_tree(&paths.photos, &old, &new).unwrap();
    rekey_local_backups(&paths.backups, &old, &new)
        .await
        .unwrap();
    journal.new_vault.save(&paths.vault).unwrap();

    // Déverrouillage avec le nouveau mot de passe (coffre principal) : la fin est rejouée.
    let typed = Vault::load(&paths.vault)
        .unwrap()
        .unlock_with_password(NEW_PASSWORD)
        .unwrap();
    resume(&paths, typed).await.unwrap();
    assert_rotated(&paths, &old, &new).await;
}

#[tokio::test]
async fn an_unreadable_file_cancels_before_anything_changes() {
    let dir = TempDir::new("unreadable");
    let paths = dir.paths();
    let (old, _) = install(&paths).await;
    fs::write(
        paths.documents.join("s1/abime.pdf"),
        files::encrypt_bytes(&MasterKey::generate(), b"autre clef").unwrap(),
    )
    .unwrap();
    let new = MasterKey::generate();
    let (vault, _) = Vault::create_with_key(NEW_PASSWORD, KdfParams::FAST, &new).unwrap();
    let error = start(&paths, &old, &new, vault).await.unwrap_err();
    assert!(matches!(
        error,
        RotationError::Unreadable("Un document joint")
    ));
    assert!(!is_pending(&paths));
    assert_eq!(clients(&paths, &old).await, ["Alice"]);
}

#[tokio::test]
async fn another_key_cannot_resume_and_changes_nothing() {
    let dir = TempDir::new("other-key");
    let paths = dir.paths();
    let (old, _) = install(&paths).await;
    prepare(&paths, &old).await;
    let error = resume(&paths, MasterKey::generate()).await.unwrap_err();
    assert!(matches!(error, RotationError::WrongKey));
    assert!(is_pending(&paths));
    assert_eq!(clients(&paths, &old).await, ["Alice"]);
    // Une seconde rotation ne peut pas commencer par-dessus.
    let other = MasterKey::generate();
    let (vault, _) = Vault::create_with_key(NEW_PASSWORD, KdfParams::FAST, &other).unwrap();
    assert!(start(&paths, &old, &other, vault).await.is_err());
}

#[tokio::test]
async fn without_a_journal_resume_returns_the_key_unchanged() {
    let dir = TempDir::new("none");
    let paths = dir.paths();
    let (old, _) = install(&paths).await;
    let key = resume(&paths, old.clone()).await.unwrap();
    assert_eq!(key.as_bytes(), old.as_bytes());
    assert_eq!(clients(&paths, &old).await, ["Alice"]);
}

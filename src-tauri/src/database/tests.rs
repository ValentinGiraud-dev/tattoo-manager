//! Chiffrement de la base : conversion depuis une version en clair, reprise après
//! coupure, sauvegardes externes et restauration.

use std::fs;
use std::path::PathBuf;

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection};

use super::*;
use crate::external_backup::{self, Secret};
use crate::security::vault::{KdfParams, Vault};

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tracink-db-{name}-{}-{}",
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

/// Base en clair d'une version précédente, migrée, avec un client.
async fn plaintext_database(path: &Path) {
    let mut conn = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .connect()
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&mut conn).await.unwrap();
    sqlx::query(
        "INSERT INTO clients (id, first_name, last_name, created_at, updated_at)
         VALUES ('c1', 'Alice', 'Martin', '2026-01-01', '2026-01-01')",
    )
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
}

async fn client_names(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar("SELECT first_name FROM clients ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

fn contains(path: &Path, needle: &[u8]) -> bool {
    fs::read(path)
        .unwrap()
        .windows(needle.len())
        .any(|window| window == needle)
}

#[tokio::test]
async fn an_old_plaintext_install_is_fully_encrypted_on_first_unlock() {
    let dir = TempDir::new("convert");
    let paths = dir.paths();
    plaintext_database(&paths.database).await;
    fs::create_dir_all(paths.documents.join("s1/a-imprimer")).unwrap();
    fs::write(paths.documents.join("s1/scan.pdf"), b"%PDF Alice Martin").unwrap();
    fs::write(
        paths.documents.join("s1/a-imprimer/sante.pdf"),
        b"%PDF sante",
    )
    .unwrap();
    fs::copy(
        &paths.database,
        paths
            .backups
            .join("database-2026-01-01-000000-v0.1.0.sqlite"),
    )
    .unwrap();
    assert!(is_plaintext_sqlite(&paths.database).unwrap());

    let key = MasterKey::generate();
    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    assert_eq!(client_names(&pool).await, ["Alice"]);
    pool.close().await;

    // Plus rien en clair : base, documents, anciennes copies.
    assert!(!is_plaintext_sqlite(&paths.database).unwrap());
    assert!(!contains(&paths.database, b"Martin"));
    assert!(!paths.root.join("database.plaintext").exists());
    assert!(!paths.root.join("database.encrypting").exists());
    for file in files::list_files(&paths.documents).unwrap() {
        assert!(files::is_encrypted_file(&file).unwrap());
    }
    for entry in fs::read_dir(&paths.backups).unwrap() {
        let path = entry.unwrap().path();
        assert!(!is_plaintext_sqlite(&path).unwrap(), "{}", path.display());
        inspect_encrypted(&path, &key).await.unwrap();
    }

    // Une autre clé n'ouvre pas la base.
    assert!(matches!(
        connect_encrypted(&paths.database, &MasterKey::generate(), false).await,
        Err(OpenError::WrongKey)
    ));

    // Le déverrouillage suivant ne refait rien et retrouve les données.
    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    assert_eq!(client_names(&pool).await, ["Alice"]);
}

#[tokio::test]
async fn a_conversion_cut_between_the_two_renames_is_resumed() {
    let dir = TempDir::new("resume");
    let paths = dir.paths();
    plaintext_database(&paths.database).await;
    let key = MasterKey::generate();

    // État laissé par une coupure : copie chiffrée complète, ancienne base renommée.
    let encrypting = paths.root.join("database.encrypting");
    export_encrypted(&paths.database, &encrypting, &key)
        .await
        .unwrap();
    move_with_sidecars(&paths.database, &paths.root.join("database.plaintext")).unwrap();
    assert!(!paths.database.exists());

    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    assert_eq!(client_names(&pool).await, ["Alice"]);
    assert!(!paths.root.join("database.plaintext").exists());
    assert!(!encrypting.exists());
}

#[tokio::test]
async fn a_conversion_cut_before_the_swap_starts_over() {
    let dir = TempDir::new("restart");
    let paths = dir.paths();
    plaintext_database(&paths.database).await;
    let key = MasterKey::generate();
    // Copie chiffrée à moitié écrite : elle est jetée et refaite.
    fs::write(paths.root.join("database.encrypting"), b"incomplet").unwrap();

    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    assert_eq!(client_names(&pool).await, ["Alice"]);
}

#[tokio::test]
async fn a_new_install_starts_encrypted() {
    let dir = TempDir::new("fresh");
    let paths = dir.paths();
    let key = MasterKey::generate();
    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    assert!(client_names(&pool).await.is_empty());
    pool.close().await;
    assert!(!is_plaintext_sqlite(&paths.database).unwrap());
}

#[tokio::test]
async fn the_lock_state_refuses_commands_until_unlocked() {
    let dir = TempDir::new("lock");
    let paths = dir.paths();
    let db = Db::default();
    assert_eq!(db.pool().unwrap_err(), LOCKED_MESSAGE);
    let key = MasterKey::generate();
    db.set(Unlocked {
        pool: open(&paths, &key, "0.2.0").await.unwrap(),
        key,
    });
    assert!(db.pool().is_ok());
    db.take().unwrap().pool.close().await;
    assert!(!db.is_unlocked());
    assert_eq!(db.key().unwrap_err(), LOCKED_MESSAGE);
}

#[tokio::test]
async fn the_fingerprint_follows_the_content_not_the_bytes() {
    let dir = TempDir::new("fingerprint");
    let paths = dir.paths();
    plaintext_database(&paths.database).await;
    let key = MasterKey::generate();
    let pool = open(&paths, &key, "0.2.0").await.unwrap();

    let first = external_backup::fingerprint(&pool).await.unwrap();
    assert_eq!(first, external_backup::fingerprint(&pool).await.unwrap());
    sqlx::query("UPDATE clients SET first_name = 'Alicia'")
        .execute(&pool)
        .await
        .unwrap();
    assert_ne!(first, external_backup::fingerprint(&pool).await.unwrap());
}

#[tokio::test]
async fn a_backup_restores_everything_and_keeps_the_replaced_data() {
    let dir = TempDir::new("backup");
    let paths = dir.paths();
    let folder = dir.0.join("iCloud");
    fs::create_dir_all(&folder).unwrap();

    let (vault, key, recovery) = Vault::create("mot de passe 1", KdfParams::FAST).unwrap();
    vault.save(&paths.vault).unwrap();
    plaintext_database(&paths.database).await;
    fs::create_dir_all(paths.documents.join("s1")).unwrap();
    fs::write(paths.documents.join("s1/scan.pdf"), b"%PDF consentement").unwrap();
    let pool = open(&paths, &key, "0.2.0").await.unwrap();

    let fingerprint = external_backup::fingerprint(&pool).await.unwrap();
    let entry = external_backup::create(&pool, &key, &paths, &folder, "0.2.0", fingerprint)
        .await
        .unwrap();
    assert!(entry.readable);
    assert_eq!(entry.documents, 1);
    let saved = folder.join(external_backup::DIR_NAME).join(&entry.name);
    assert!(!contains(&saved.join("database.sqlite"), b"Martin"));
    assert!(!contains(
        &saved.join("documents/s1/scan.pdf"),
        b"consentement"
    ));
    assert_eq!(external_backup::list(&folder).unwrap().len(), 1);

    // Les données changent après la sauvegarde.
    sqlx::query("UPDATE clients SET first_name = 'Modifié'")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    // Mauvais secret : refusé, rien n'est touché.
    assert!(
        external_backup::verify(&folder, &entry.name, Secret::Password("faux mot de passe"))
            .await
            .is_err()
    );
    assert!(
        external_backup::verify(&folder, "../../etc", Secret::Password("mot de passe 1"))
            .await
            .is_err()
    );

    let verified = external_backup::verify(
        &folder,
        &entry.name,
        Secret::RecoveryKey(recovery.display()),
    )
    .await
    .unwrap();
    let aside = external_backup::replace_current_data(&paths, &verified).unwrap();
    assert!(aside.join("database.sqlite").exists());
    assert!(aside.join("documents/s1/scan.pdf").exists());

    let pool = open(&paths, &verified.key, "0.2.0").await.unwrap();
    assert_eq!(client_names(&pool).await, ["Alice"]);
    assert_eq!(
        files::decrypt_file(&verified.key, &paths.documents.join("s1/scan.pdf")).unwrap(),
        b"%PDF consentement"
    );
    // Le coffre restauré s'ouvre avec le mot de passe de la sauvegarde.
    assert!(Vault::load(&paths.vault)
        .unwrap()
        .unlock_with_password("mot de passe 1")
        .is_ok());
}

#[tokio::test]
async fn a_backup_from_a_newer_version_is_refused() {
    let dir = TempDir::new("newer");
    let paths = dir.paths();
    let folder = dir.0.join("disque");
    fs::create_dir_all(&folder).unwrap();
    let (vault, key, _) = Vault::create("mot de passe 1", KdfParams::FAST).unwrap();
    vault.save(&paths.vault).unwrap();
    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    let entry = external_backup::create(&pool, &key, &paths, &folder, "0.2.0", "x".into())
        .await
        .unwrap();

    let manifest_path = folder
        .join(external_backup::DIR_NAME)
        .join(&entry.name)
        .join("manifest.json");
    let text = fs::read_to_string(&manifest_path).unwrap();
    let mut manifest: external_backup::Manifest = serde_json::from_str(&text).unwrap();
    manifest.migration = latest_known_migration() + 1;
    fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).unwrap();

    let error = external_backup::verify(&folder, &entry.name, Secret::Password("mot de passe 1"))
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("plus récente"));
}

#[tokio::test]
async fn old_backups_beyond_the_limit_are_removed() {
    let dir = TempDir::new("prune");
    let paths = dir.paths();
    let folder = dir.0.join("disque");
    let root = folder.join(external_backup::DIR_NAME);
    fs::create_dir_all(&root).unwrap();
    for day in 1..=external_backup::KEEP {
        fs::create_dir_all(root.join(format!("2020-01-{day:02}-120000"))).unwrap();
    }
    fs::create_dir_all(root.join(".2020-01-01-000000.partial")).unwrap();
    fs::create_dir_all(root.join("a-garder")).unwrap();

    let (vault, key, _) = Vault::create("mot de passe 1", KdfParams::FAST).unwrap();
    vault.save(&paths.vault).unwrap();
    let pool = open(&paths, &key, "0.2.0").await.unwrap();
    external_backup::create(&pool, &key, &paths, &folder, "0.2.0", "x".into())
        .await
        .unwrap();

    let list = external_backup::list(&folder).unwrap();
    assert_eq!(list.len(), external_backup::KEEP);
    // Choisir directement le dossier `Tracink-sauvegardes` revient au même.
    assert_eq!(
        external_backup::list(&root).unwrap().len(),
        external_backup::KEEP
    );
    assert_eq!(external_backup::normalize_folder(&root), folder);
    assert_eq!(external_backup::normalize_folder(&folder), folder);
    assert!(!root.join("2020-01-01-120000").exists());
    assert!(root.join("2020-01-02-120000").exists());
    assert!(!root.join(".2020-01-01-000000.partial").exists());
    // Ce qui n'est pas une sauvegarde de Tracink n'est jamais supprimé.
    assert!(root.join("a-garder").exists());
}

#[tokio::test]
async fn a_missing_backup_folder_is_reported_clearly() {
    let dir = TempDir::new("missing");
    let error = external_backup::list(&dir.0.join("disque-debranche")).unwrap_err();
    assert!(error.to_string().contains("branché"));
}

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub photos: PathBuf,
    pub documents: PathBuf,
    pub backups: PathBuf,
    pub settings: PathBuf,
    /// Clé maître chiffrée (mot de passe, clé de secours).
    pub vault: PathBuf,
    /// Copies en clair ouvertes dans Aperçu ou à imprimer. Vidé au verrouillage.
    pub opened: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPathsDto {
    pub root: String,
    pub database: String,
    pub photos: String,
    pub documents: String,
    pub backups: String,
    pub settings: String,
}

impl AppPaths {
    pub fn under(root: PathBuf, opened: PathBuf) -> Self {
        Self {
            database: root.join("database.sqlite"),
            photos: root.join("photos"),
            documents: root.join("documents"),
            backups: root.join("backups"),
            settings: root.join("settings.json"),
            vault: root.join("vault.json"),
            opened,
            root,
        }
    }

    pub fn to_dto(&self) -> AppPathsDto {
        AppPathsDto {
            root: self.root.display().to_string(),
            database: self.database.display().to_string(),
            photos: self.photos.display().to_string(),
            documents: self.documents.display().to_string(),
            backups: self.backups.display().to_string(),
            settings: self.settings.display().to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowSettings {
    pub width: u32,
    pub height: u32,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            width: 1200,
            height: 800,
        }
    }
}

/// Informations de l'atelier reportées sur les documents imprimés.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StudioSettings {
    /// « Professionnel réalisant l'acte » sur le consentement.
    pub professional_name: String,
    /// « Fait à » sur le consentement.
    pub city: String,
}

/// Verrouillage de l'app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SecuritySettings {
    /// Verrouillage après ce nombre de minutes sans activité (0 = jamais).
    pub auto_lock_minutes: u32,
    pub touch_id: bool,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            auto_lock_minutes: 10,
            touch_id: false,
        }
    }
}

pub const AUTO_LOCK_CHOICES: [u32; 6] = [0, 2, 5, 10, 15, 30];

/// Sauvegardes vers un dossier choisi (iCloud Drive, disque externe…).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BackupSettings {
    pub folder: Option<String>,
    /// Dernière sauvegarde créée.
    pub last_backup_at: Option<String>,
    /// Dernière vérification réussie (sauvegarde créée, ou rien de changé depuis).
    pub last_check_at: Option<String>,
    /// Empreinte du contenu de la dernière sauvegarde, pour ne pas en refaire une identique.
    pub last_fingerprint: Option<String>,
    /// Dernier échec, effacé à la réussite suivante.
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub locale: String,
    pub window: WindowSettings,
    pub studio: StudioSettings,
    pub security: SecuritySettings,
    pub backup: BackupSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            locale: "fr".to_string(),
            window: WindowSettings::default(),
            studio: StudioSettings::default(),
            security: SecuritySettings::default(),
            backup: BackupSettings::default(),
        }
    }
}

pub fn init(app: &AppHandle) -> Result<AppPaths, Box<dyn std::error::Error>> {
    let root = app.path().app_data_dir()?;
    let paths = AppPaths::under(root, std::env::temp_dir().join("com.tracink.app-ouverts"));

    fs::create_dir_all(&paths.root)?;
    fs::create_dir_all(&paths.photos)?;
    fs::create_dir_all(&paths.documents)?;
    fs::create_dir_all(&paths.backups)?;
    clear_opened(&paths);

    if !paths.settings.exists() {
        save_settings(&paths, &AppSettings::default())?;
    }

    eprintln!("données application : {}", paths.root.display());
    Ok(paths)
}

/// Supprime les copies en clair ouvertes (au démarrage et au verrouillage).
pub fn clear_opened(paths: &AppPaths) {
    if paths.opened.exists() {
        if let Err(error) = fs::remove_dir_all(&paths.opened) {
            eprintln!("nettoyage des fichiers ouverts : {}", error.kind());
        }
    }
}

pub fn load_settings(paths: &AppPaths) -> Result<AppSettings, Box<dyn std::error::Error>> {
    if !paths.settings.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(&paths.settings)?;
    let settings = serde_json::from_str(&contents)?;
    Ok(settings)
}

pub fn save_settings(
    paths: &AppPaths,
    settings: &AppSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    let contents = serde_json::to_string_pretty(settings)?;
    crate::security::vault::write_atomic(&paths.settings, contents.as_bytes())?;
    Ok(())
}

static SETTINGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Lit, modifie et réécrit les réglages sans perdre une écriture concurrente
/// (ex. date de sauvegarde écrite pendant que l'écran Paramètres enregistre).
pub fn modify_settings(
    paths: &AppPaths,
    change: impl FnOnce(&mut AppSettings),
) -> Result<AppSettings, Box<dyn std::error::Error>> {
    let _guard = SETTINGS_LOCK.lock().map_err(|_| "réglages indisponibles")?;
    let mut settings = load_settings(paths)?;
    change(&mut settings);
    save_settings(paths, &settings)?;
    Ok(settings)
}

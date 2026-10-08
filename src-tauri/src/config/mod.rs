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
#[serde(rename_all = "camelCase")]
pub struct WindowSettings {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub locale: String,
    pub window: WindowSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            locale: "fr".to_string(),
            window: WindowSettings {
                width: 1200,
                height: 800,
            },
        }
    }
}

pub fn init(app: &AppHandle) -> Result<AppPaths, Box<dyn std::error::Error>> {
    let root = app.path().app_data_dir()?;
    let paths = AppPaths {
        database: root.join("database.sqlite"),
        photos: root.join("photos"),
        documents: root.join("documents"),
        backups: root.join("backups"),
        settings: root.join("settings.json"),
        root,
    };

    fs::create_dir_all(&paths.root)?;
    fs::create_dir_all(&paths.photos)?;
    fs::create_dir_all(&paths.documents)?;
    fs::create_dir_all(&paths.backups)?;

    if !paths.settings.exists() {
        save_settings(&paths, &AppSettings::default())?;
    }

    eprintln!("données application : {}", paths.root.display());
    Ok(paths)
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
    fs::write(&paths.settings, contents)?;
    Ok(())
}

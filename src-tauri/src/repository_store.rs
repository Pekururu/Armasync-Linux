use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct SavedRepository {
    pub id: String,
    pub name: String,
    pub autoconfig_url: String,
    pub destination: String,
}

#[derive(Default, Deserialize, Serialize)]
struct RepositoryConfig {
    #[serde(default)]
    repositories: Vec<SavedRepository>,
}

pub fn list() -> Result<Vec<SavedRepository>, String> {
    Ok(load()?.repositories)
}

pub fn get(id: &str) -> Result<SavedRepository, String> {
    load()?
        .repositories
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "repository was not found".to_owned())
}

pub fn add(name: String, url: String, destination: String) -> Result<Vec<SavedRepository>, String> {
    let _config_lock = crate::persistence::lock(&config_path()?)?;
    let destination = validate_destination(&destination)?;
    let mut config = load()?;
    if config
        .repositories
        .iter()
        .any(|item| item.autoconfig_url == url)
    {
        return Err("this repository is already configured".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    config.repositories.push(SavedRepository {
        id: format!("repository-{stamp:x}"),
        name,
        autoconfig_url: url,
        destination: destination.to_string_lossy().into_owned(),
    });
    save(&config)?;
    Ok(config.repositories)
}

pub fn update(id: &str, destination: String) -> Result<Vec<SavedRepository>, String> {
    let _config_lock = crate::persistence::lock(&config_path()?)?;
    let destination = validate_destination(&destination)?;
    let mut config = load()?;
    let item = config
        .repositories
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "repository was not found".to_owned())?;
    item.destination = destination.to_string_lossy().into_owned();
    save(&config)?;
    Ok(config.repositories)
}

pub fn remove(id: &str) -> Result<Vec<SavedRepository>, String> {
    let _config_lock = crate::persistence::lock(&config_path()?)?;
    let mut config = load()?;
    let before = config.repositories.len();
    config.repositories.retain(|item| item.id != id);
    if before == config.repositories.len() {
        return Err("repository was not found".into());
    }
    save(&config)?;
    Ok(config.repositories)
}

fn validate_destination(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err("repository destination must be an absolute path".into());
    }
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create repository destination: {error}"))?;
    fs::canonicalize(path)
        .map_err(|error| format!("could not open repository destination: {error}"))
}

fn config_path() -> Result<PathBuf, String> {
    crate::persistence::config_path("repositories.toml")
}

fn load() -> Result<RepositoryConfig, String> {
    crate::persistence::load(&config_path()?)
}

fn save(config: &RepositoryConfig) -> Result<(), String> {
    crate::persistence::save(&config_path()?, config)
}

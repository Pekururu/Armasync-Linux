use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
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
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME is not set".to_owned())?;
    Ok(PathBuf::from(home).join(".config/armalauncher/repositories.toml"))
}

fn load() -> Result<RepositoryConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(RepositoryConfig::default());
    }
    let input = fs::read_to_string(&path)
        .map_err(|error| format!("could not read repository settings: {error}"))?;
    toml::from_str(&input).map_err(|error| format!("could not parse repository settings: {error}"))
}

fn save(config: &RepositoryConfig) -> Result<(), String> {
    let path = config_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "invalid repository settings path".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create settings directory: {error}"))?;
    let temporary = path.with_extension("toml.tmp");
    let output = toml::to_string_pretty(config)
        .map_err(|error| format!("could not encode repository settings: {error}"))?;
    fs::write(&temporary, output)
        .map_err(|error| format!("could not write repository settings: {error}"))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("could not commit repository settings: {error}"))
}

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct LaunchSelection {
    pub active_addon_group_id: Option<String>,
    pub selected_server_id: Option<String>,
    pub player_profile: Option<String>,
}

pub fn load() -> Result<LaunchSelection, String> {
    let path = config_path()?;
    if !path.is_file() {
        return Ok(LaunchSelection::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    toml::from_str(&contents)
        .map_err(|error| format!("could not parse {}: {error}", path.display()))
}

pub fn save(selection: LaunchSelection) -> Result<LaunchSelection, String> {
    validate(&selection)?;
    let path = config_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "invalid launch selection path".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let contents = toml::to_string_pretty(&selection)
        .map_err(|error| format!("could not serialize launch selection: {error}"))?;
    let temporary = path.with_extension("toml.tmp");
    fs::write(&temporary, contents)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, &path)
        .map_err(|error| format!("could not replace {}: {error}", path.display()))?;
    Ok(selection)
}

fn validate(selection: &LaunchSelection) -> Result<(), String> {
    let fields = [
        ("addon group", &selection.active_addon_group_id),
        ("server", &selection.selected_server_id),
        ("player profile", &selection.player_profile),
    ];
    for (label, value) in fields {
        if let Some(value) = value
            && (value.is_empty() || value.chars().count() > 200 || value.chars().any(char::is_control))
        {
            return Err(format!("invalid saved launch bar {label} selection"));
        }
    }
    Ok(())
}

fn config_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or_else(|| "could not determine the user configuration directory".to_owned())?;
    Ok(base.join("armalauncher/launch-selection.toml"))
}

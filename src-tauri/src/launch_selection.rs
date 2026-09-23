use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct LaunchSelection {
    pub active_addon_group_id: Option<String>,
    pub selected_server_id: Option<String>,
    pub player_profile: Option<String>,
}

pub fn load() -> Result<LaunchSelection, String> {
    crate::persistence::load(&config_path()?)
}

pub fn save(selection: LaunchSelection) -> Result<LaunchSelection, String> {
    validate(&selection)?;
    let path = config_path()?;
    let _lock = crate::persistence::lock(&path)?;
    crate::persistence::save(&path, &selection)?;
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
            && (value.is_empty()
                || value.chars().count() > 200
                || value.chars().any(char::is_control))
        {
            return Err(format!("invalid saved launch bar {label} selection"));
        }
    }
    Ok(())
}

fn config_path() -> Result<PathBuf, String> {
    crate::persistence::config_path("launch-selection.toml")
}

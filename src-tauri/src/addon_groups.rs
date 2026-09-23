use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GroupSource {
    pub repository_id: String,
    pub modset_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AddonGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub addon_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub source: Option<GroupSource>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AddonGroupsConfig {
    #[serde(default)]
    groups: Vec<AddonGroup>,
}

pub fn list() -> Result<Vec<AddonGroup>, String> {
    let groups = load()?.groups;
    if groups.is_empty() {
        return Ok(vec![default_group()]);
    }
    validate(&groups)?;
    Ok(groups)
}

pub fn save(groups: Vec<AddonGroup>) -> Result<Vec<AddonGroup>, String> {
    validate(&groups)?;
    let config = AddonGroupsConfig { groups };
    let path = config_path()?;
    let _lock = crate::persistence::lock(&path)?;
    crate::persistence::save(&path, &config)?;
    Ok(config.groups)
}

fn load() -> Result<AddonGroupsConfig, String> {
    crate::persistence::load(&config_path()?)
}

fn validate(groups: &[AddonGroup]) -> Result<(), String> {
    if groups.is_empty() {
        return Err("at least one addon group is required".into());
    }
    if groups.len() > 200 {
        return Err("no more than 200 addon groups may be saved".into());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for group in groups {
        if group.id.is_empty()
            || group.id.len() > 80
            || !group
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            || !ids.insert(group.id.as_str())
        {
            return Err("addon groups must have unique valid IDs".into());
        }
        let name = group.name.trim();
        if name.is_empty()
            || name != group.name
            || name.chars().count() > 100
            || name.chars().any(char::is_control)
            || !names.insert(name.to_ascii_lowercase())
        {
            return Err("addon group names must be unique and contain 1 to 100 characters".into());
        }
        if group.addon_ids.len() > 2_000 {
            return Err(format!(
                "addon group {} contains too many entries",
                group.name
            ));
        }
        let mut addon_ids = HashSet::new();
        if group.addon_ids.iter().any(|id| {
            id.is_empty()
                || id.len() > 4_096
                || id.chars().any(char::is_control)
                || !addon_ids.insert(id.as_str())
        }) {
            return Err(format!(
                "addon group {} contains invalid or duplicate entries",
                group.name
            ));
        }
        if let Some(source) = &group.source
            && (source.repository_id.is_empty()
                || source.repository_id.len() > 100
                || source.modset_name.trim().is_empty()
                || source.modset_name.chars().count() > 200
                || source.repository_id.chars().any(char::is_control)
                || source.modset_name.chars().any(char::is_control))
        {
            return Err(format!(
                "addon group {} has an invalid repository source",
                group.name
            ));
        }
    }
    Ok(())
}

fn default_group() -> AddonGroup {
    AddonGroup {
        id: "default".into(),
        name: "Default".into(),
        addon_ids: Vec::new(),
        source: None,
    }
}

fn config_path() -> Result<PathBuf, String> {
    crate::persistence::config_path("addon-groups.toml")
}

#[cfg(test)]
mod tests {
    use super::{AddonGroup, validate};

    #[test]
    fn preserves_order_but_rejects_duplicate_addons() {
        let valid = AddonGroup {
            id: "unit".into(),
            name: "Unit".into(),
            addon_ids: vec!["path:/b".into(), "path:/a".into()],
            source: None,
        };
        assert!(validate(std::slice::from_ref(&valid)).is_ok());
        let duplicate = AddonGroup {
            addon_ids: vec!["path:/a".into(), "path:/a".into()],
            ..valid
        };
        assert!(validate(&[duplicate]).is_err());
    }

    #[test]
    fn rejects_duplicate_names_case_insensitively() {
        let first = AddonGroup {
            id: "one".into(),
            name: "Unit".into(),
            addon_ids: Vec::new(),
            source: None,
        };
        let second = AddonGroup {
            id: "two".into(),
            name: "unit".into(),
            addon_ids: Vec::new(),
            source: None,
        };
        assert!(validate(&[first, second]).is_err());
    }
}

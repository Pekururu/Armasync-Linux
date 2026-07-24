use regex::Regex;
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy)]
struct DlcDefinition {
    handle: &'static str,
    name: &'static str,
    app_id: u32,
    directory: &'static str,
    creator_dlc: bool,
}

const SELECTABLE_DLC: &[DlcDefinition] = &[
    DlcDefinition {
        handle: "contact",
        name: "Arma 3 Contact",
        app_id: 1_021_790,
        directory: "Contact",
        creator_dlc: false,
    },
    DlcDefinition {
        handle: "gm",
        name: "Global Mobilization",
        app_id: 1_042_220,
        directory: "GM",
        creator_dlc: true,
    },
    DlcDefinition {
        handle: "vn",
        name: "S.O.G. Prairie Fire",
        app_id: 1_227_700,
        directory: "VN",
        creator_dlc: true,
    },
    DlcDefinition {
        handle: "csla",
        name: "CSLA Iron Curtain",
        app_id: 1_294_440,
        directory: "CSLA",
        creator_dlc: true,
    },
    DlcDefinition {
        handle: "ws",
        name: "Western Sahara",
        app_id: 1_681_170,
        directory: "WS",
        creator_dlc: true,
    },
    DlcDefinition {
        handle: "spe",
        name: "Spearhead 1944",
        app_id: 1_175_380,
        directory: "SPE",
        creator_dlc: true,
    },
    DlcDefinition {
        handle: "rf",
        name: "Reaction Forces",
        app_id: 2_647_760,
        directory: "RF",
        creator_dlc: true,
    },
    DlcDefinition {
        handle: "ef",
        name: "Expeditionary Forces",
        app_id: 2_647_830,
        directory: "EF",
        creator_dlc: true,
    },
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedDlc {
    pub handle: String,
    pub name: String,
    pub app_id: u32,
    pub directory: Option<String>,
    pub creator_dlc: bool,
    pub status: DlcStatus,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DlcStatus {
    Installed,
    Disabled,
    FilesOnly,
    Incomplete,
    Unavailable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlcDetection {
    pub game_directory: Option<String>,
    pub manifest_path: Option<String>,
    pub dlcs: Vec<DetectedDlc>,
}

pub fn detect() -> DlcDetection {
    let Some(installation) = crate::steam::discover_arma() else {
        return DlcDetection {
            game_directory: None,
            manifest_path: None,
            dlcs: catalog_without_installation(),
        };
    };

    let manifest = fs::read_to_string(&installation.manifest_path).unwrap_or_default();
    let game_directory = installation.game_directory;
    let installed_app_ids = installed_dlc_ids(&manifest);
    let disabled_app_ids = disabled_dlc_ids(&manifest);

    let dlcs = SELECTABLE_DLC
        .iter()
        .map(|definition| {
            let directory = find_directory_case_insensitive(&game_directory, definition.directory);
            let depot_installed = installed_app_ids.contains(&definition.app_id);
            let disabled = disabled_app_ids.contains(&definition.app_id);
            let status = if disabled {
                DlcStatus::Disabled
            } else {
                match (depot_installed, directory.is_some()) {
                    (true, true) => DlcStatus::Installed,
                    (true, false) => DlcStatus::Incomplete,
                    (false, true) => DlcStatus::FilesOnly,
                    (false, false) => DlcStatus::Unavailable,
                }
            };

            DetectedDlc {
                handle: definition.handle.into(),
                name: definition.name.into(),
                app_id: definition.app_id,
                directory: directory.map(|path| path.to_string_lossy().into_owned()),
                creator_dlc: definition.creator_dlc,
                status,
            }
        })
        .collect();

    DlcDetection {
        game_directory: Some(game_directory.to_string_lossy().into_owned()),
        manifest_path: Some(installation.manifest_path.to_string_lossy().into_owned()),
        dlcs,
    }
}

fn catalog_without_installation() -> Vec<DetectedDlc> {
    SELECTABLE_DLC
        .iter()
        .map(|definition| DetectedDlc {
            handle: definition.handle.into(),
            name: definition.name.into(),
            app_id: definition.app_id,
            directory: None,
            creator_dlc: definition.creator_dlc,
            status: DlcStatus::Unavailable,
        })
        .collect()
}

fn installed_dlc_ids(manifest: &str) -> HashSet<u32> {
    let pattern = Regex::new(r#""dlcappid"\s+"(\d+)""#).expect("valid DLC app ID regex");
    pattern
        .captures_iter(manifest)
        .filter_map(|capture| capture[1].parse().ok())
        .collect()
}

fn disabled_dlc_ids(manifest: &str) -> HashSet<u32> {
    capture_value(manifest, "DisabledDLC")
        .into_iter()
        .flat_map(|value| {
            value
                .split(|character: char| !character.is_ascii_digit())
                .filter_map(|part| part.parse().ok())
                .collect::<Vec<_>>()
        })
        .collect()
}

fn capture_value(contents: &str, key: &str) -> Option<String> {
    let pattern = Regex::new(&format!(r#""{}"\s+"([^"]*)""#, regex::escape(key))).ok()?;
    pattern
        .captures(contents)
        .map(|capture| capture[1].to_owned())
}

fn find_directory_case_insensitive(parent: &Path, expected: &str) -> Option<PathBuf> {
    fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .find_map(|entry| {
            let is_directory = entry.file_type().ok()?.is_dir();
            let matches = entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(expected);
            (is_directory && matches).then(|| entry.path())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_installed_and_disabled_dlc_ids() {
        let manifest = r#"
            "10" { "dlcappid" "1042220" }
            "UserConfig" { "DisabledDLC" "1227700,1294440" }
        "#;
        assert!(installed_dlc_ids(manifest).contains(&1_042_220));
        let disabled = disabled_dlc_ids(manifest);
        assert!(disabled.contains(&1_227_700));
        assert!(disabled.contains(&1_294_440));
    }
}

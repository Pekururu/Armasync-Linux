use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::model::{LauncherEnvironment, LauncherOptionsView};

#[derive(Clone, Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SavedServer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(default, rename_all = "camelCase")]
pub struct LauncherSettings {
    pub profile: Option<String>,
    pub no_launcher: bool,
    pub no_splash: bool,
    pub skip_intro: bool,
    pub no_pause: bool,
    pub show_script_errors: bool,
    pub world_empty: bool,
    pub file_patching: bool,
    pub check_signatures: bool,
    pub enable_ht: bool,
    pub huge_pages: bool,
    pub cpu_count: Option<u8>,
    pub ex_threads: Option<u8>,
    pub max_memory: Option<u32>,
    pub player_profiles: Vec<String>,
    pub servers: Vec<SavedServer>,
    pub selected_server_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub server_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub server_port: Option<u16>,
    pub extra_arguments: Vec<String>,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            profile: None,
            no_launcher: true,
            no_splash: true,
            skip_intro: true,
            no_pause: false,
            show_script_errors: false,
            world_empty: false,
            file_patching: false,
            check_signatures: false,
            enable_ht: false,
            huge_pages: false,
            cpu_count: None,
            ex_threads: None,
            max_memory: None,
            player_profiles: Vec::new(),
            servers: Vec::new(),
            selected_server_id: None,
            server_address: None,
            server_port: None,
            extra_arguments: Vec::new(),
        }
    }
}

pub fn view() -> Result<LauncherOptionsView, String> {
    build_view(load()?)
}

pub fn preview(settings: LauncherSettings) -> Result<LauncherOptionsView, String> {
    build_view(settings)
}

pub fn save(settings: LauncherSettings) -> Result<LauncherOptionsView, String> {
    validate(&settings)?;
    let path = config_path()?;
    let _lock = crate::persistence::lock(&path)?;
    crate::persistence::save(&path, &settings)?;
    build_view(settings)
}

pub fn reset() -> Result<LauncherOptionsView, String> {
    save(LauncherSettings::default())
}

pub(crate) fn load() -> Result<LauncherSettings, String> {
    let mut settings: LauncherSettings = crate::persistence::load(&config_path()?)?;
    if settings.player_profiles.is_empty()
        && let Some(profile) = settings.profile.take()
    {
        settings.player_profiles.push(profile);
    }
    if settings.servers.is_empty()
        && let Some(address) = settings.server_address.take()
    {
        settings.servers.push(SavedServer {
            id: "imported-server".into(),
            name: "Saved server".into(),
            address,
            port: settings.server_port.take().unwrap_or(2302),
            password: None,
        });
        settings.selected_server_id = Some("imported-server".into());
    }
    validate(&settings)?;
    Ok(settings)
}

fn build_view(settings: LauncherSettings) -> Result<LauncherOptionsView, String> {
    validate(&settings)?;
    let installation = crate::steam::discover_arma();
    let executable = installation
        .as_ref()
        .map(|item| item.game_directory.join("arma3_x64.exe"))
        .filter(|path| path.is_file());
    let profiles = installation
        .as_ref()
        .map(|item| discover_profiles(&item.prefix_directory))
        .unwrap_or_default();
    let environment = LauncherEnvironment {
        game_directory: installation
            .as_ref()
            .map(|item| path_string(&item.game_directory)),
        executable: executable.as_ref().map(|path| path_string(path)),
        prefix_directory: installation
            .as_ref()
            .map(|item| path_string(&item.prefix_directory)),
        selected_proton: crate::steam::selected_proton(),
        profiles,
    };
    let arguments = arguments(&settings);
    let executable = environment
        .executable
        .as_deref()
        .unwrap_or("<arma3_x64.exe>");
    let command_preview = std::iter::once("protontricks-launch".to_owned())
        .chain(["--appid".into(), "107410".into(), shell_preview(executable)])
        .chain(arguments.iter().map(|argument| shell_preview(argument)))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(LauncherOptionsView {
        settings,
        environment,
        arguments,
        command_preview,
    })
}

pub(crate) fn arguments(settings: &LauncherSettings) -> Vec<String> {
    let mut args = Vec::new();
    for (enabled, flag) in [
        (settings.no_launcher, "-noLauncher"),
        (settings.no_splash, "-noSplash"),
        (settings.skip_intro, "-skipIntro"),
        (settings.no_pause, "-noPause"),
        (settings.show_script_errors, "-showScriptErrors"),
        (settings.file_patching, "-filePatching"),
        (settings.check_signatures, "-checkSignatures"),
        (settings.enable_ht, "-enableHT"),
        (settings.huge_pages, "-hugePages"),
    ] {
        if enabled {
            args.push(flag.into());
        }
    }
    if settings.world_empty {
        args.push("-world=empty".into());
    }
    if let Some(value) = settings.cpu_count {
        args.push(format!("-cpuCount={value}"));
    }
    if let Some(value) = settings.ex_threads {
        args.push(format!("-exThreads={value}"));
    }
    if let Some(value) = settings.max_memory {
        args.push(format!("-maxMem={value}"));
    }
    args.extend(settings.extra_arguments.iter().cloned());
    args
}

fn validate(settings: &LauncherSettings) -> Result<(), String> {
    if settings.cpu_count == Some(0) {
        return Err("CPU count must be greater than zero".into());
    }
    if settings.ex_threads.is_some_and(|value| value > 7) {
        return Err("Extra threads must be between 0 and 7".into());
    }
    if settings.max_memory.is_some_and(|value| value < 512) {
        return Err("Maximum memory must be at least 512 MB".into());
    }
    if let Some(profile) = &settings.profile {
        validate_profile(profile)?;
    }
    let mut profile_names = std::collections::HashSet::new();
    for profile in &settings.player_profiles {
        validate_profile(profile)?;
        if !profile_names.insert(profile.to_ascii_lowercase()) {
            return Err("player profile names must be unique".into());
        }
    }
    let mut server_ids = std::collections::HashSet::new();
    for server in &settings.servers {
        if server.id.is_empty()
            || server.id.len() > 64
            || !server
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            || !server_ids.insert(server.id.as_str())
        {
            return Err("saved servers must have unique valid IDs".into());
        }
        if server.name.trim().is_empty()
            || server.name.trim() != server.name
            || server.name.chars().count() > 80
            || server.name.chars().any(char::is_control)
        {
            return Err("server name must contain 1 to 80 characters".into());
        }
        if server.address.trim().is_empty()
            || server.address.len() > 253
            || server.address.contains(['\0', ' ', ';', '/', '\\'])
        {
            return Err(format!("invalid address for server {}", server.name));
        }
        if server.port == 0 {
            return Err(format!("invalid port for server {}", server.name));
        }
        if server.password.as_ref().is_some_and(|password| {
            password.is_empty() || password.len() > 128 || password.chars().any(char::is_control)
        }) {
            return Err(format!("invalid password for server {}", server.name));
        }
    }
    if settings
        .selected_server_id
        .as_ref()
        .is_some_and(|id| !server_ids.contains(id.as_str()))
    {
        return Err("selected server no longer exists".into());
    }
    for argument in &settings.extra_arguments {
        let value = argument.trim();
        let lower = value.to_ascii_lowercase();
        if value.is_empty()
            || value.len() > 512
            || value.contains(['\0', '\n', '\r'])
            || lower == "-mod"
            || lower.starts_with("-mod=")
            || lower == "-usebe"
            || lower.contains("battleye")
        {
            return Err(format!("unsafe or invalid custom argument: {value}"));
        }
    }
    Ok(())
}

pub(crate) fn validate_profile(profile: &str) -> Result<(), String> {
    let trimmed = profile.trim();
    let lower = trimmed.to_ascii_lowercase();
    if trimmed.is_empty()
        || trimmed != profile
        || profile.chars().count() > 64
        || profile.chars().any(char::is_control)
        || profile.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|', ';'])
        || matches!(trimmed, "." | "..")
        || trimmed.ends_with('.')
        || lower.ends_with(".vars")
        || lower.ends_with(".3den")
    {
        return Err("player name contains characters Arma cannot use".into());
    }
    Ok(())
}

fn discover_profiles(prefix: &Path) -> Vec<String> {
    let mut profiles = WalkDir::new(prefix.join("pfx/drive_c/users"))
        .max_depth(8)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| profile_name(entry.path()))
        .collect::<Vec<_>>();
    profiles.sort_by_key(|item| item.to_ascii_lowercase());
    profiles.dedup();
    profiles
}

fn profile_name(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    let suffix = ".Arma3Profile";
    if file_name.len() <= suffix.len()
        || !file_name[file_name.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    {
        return None;
    }
    let encoded = &file_name[..file_name.len() - suffix.len()];
    let lower = encoded.to_ascii_lowercase();
    if lower.ends_with(".vars") || lower.ends_with(".3den") {
        return None;
    }
    decode_profile_name(encoded)
}

fn decode_profile_name(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16)?;
            let low = (bytes[index + 2] as char).to_digit(16)?;
            decoded.push((high * 16 + low) as u8);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded)
        .ok()
        .filter(|name| !name.is_empty())
}

fn config_path() -> Result<PathBuf, String> {
    crate::persistence::config_path("launcher.toml")
}
fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
fn shell_preview(value: &str) -> String {
    if value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-_=./:\\".contains(&byte))
    {
        value.into()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::{LauncherSettings, SavedServer, arguments, profile_name, validate};
    use std::path::Path;
    #[test]
    fn settings_written_before_display_mode_was_removed_still_load() {
        // displayMode was dropped in 0.3.2. Files on disk still carry it, and
        // losing this tolerance would take the user's servers and profiles with it.
        let existing = r#"
displayMode = "borderless_window"
noLauncher = true
playerProfiles = ["Rifleman"]

[[servers]]
id = "1f0a0c1e-0000-4000-8000-000000000000"
name = "Unit server"
address = "play.example.org"
port = 2302
"#;
        let settings: LauncherSettings =
            toml::from_str(existing).expect("settings from an earlier version must still parse");
        assert!(settings.no_launcher);
        assert_eq!(settings.player_profiles, vec!["Rifleman".to_string()]);
        assert_eq!(settings.servers.len(), 1);
        assert!(!arguments(&settings).contains(&"-window".into()));
    }

    #[test]
    fn launch_arguments_leave_the_game_window_settings_alone() {
        let settings = LauncherSettings::default();
        let args = arguments(&settings);
        assert!(!args.contains(&"-window".into()));
        assert!(args.contains(&"-noSplash".into()));
    }
    #[test]
    fn rejects_mod_and_battleye_overrides() {
        for value in ["-mod=@x", "-useBE", "-BattlEye"] {
            let settings = LauncherSettings {
                extra_arguments: vec![value.into()],
                ..Default::default()
            };
            assert!(validate(&settings).is_err());
        }
    }
    #[test]
    fn hides_companion_profile_files_and_decodes_names() {
        assert_eq!(
            profile_name(Path::new("Pek%20Lowlands.Arma3Profile")).as_deref(),
            Some("Pek Lowlands")
        );
        assert!(profile_name(Path::new("steamuser.vars.Arma3Profile")).is_none());
        assert!(profile_name(Path::new("steamuser.3den.Arma3Profile")).is_none());
    }
    #[test]
    fn rejects_names_that_collide_with_companion_files() {
        let settings = LauncherSettings {
            profile: Some("Player.vars".into()),
            ..Default::default()
        };
        assert!(validate(&settings).is_err());
    }
    #[test]
    fn saved_server_does_not_become_a_persistent_launch_argument() {
        let settings = LauncherSettings {
            servers: vec![SavedServer {
                id: "unit".into(),
                name: "Unit server".into(),
                address: "play.example.org".into(),
                port: 2302,
                password: None,
            }],
            selected_server_id: Some("unit".into()),
            ..Default::default()
        };
        let args = arguments(&settings);
        assert!(!args.iter().any(|arg| arg.starts_with("-connect=")));
    }
}

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use crate::model::{LaunchAddonInput, LaunchAddonKind, ProcessLaunchResult};

pub fn launch(
    addons: Vec<LaunchAddonInput>,
    selected_server_id: Option<String>,
    player_profile: Option<String>,
) -> Result<ProcessLaunchResult, String> {
    let installation =
        crate::steam::discover_arma().ok_or_else(|| "Arma 3 was not found".to_owned())?;
    let executable = installation.game_directory.join("arma3_x64.exe");
    if !executable.is_file() {
        return Err("arma3_x64.exe was not found".into());
    }
    if !installation.prefix_directory.join("pfx/drive_c").is_dir() {
        return Err("Launch Arma once before using the launcher".into());
    }
    if !command_exists("protontricks-launch") {
        return Err("protontricks-launch is not installed".into());
    }

    let allowed_mods: HashSet<PathBuf> = crate::sources::catalog()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|addon| fs::canonicalize(addon.path).ok())
        .collect();
    let allowed_dlcs: HashSet<String> = crate::dlc::detect()
        .dlcs
        .into_iter()
        .filter(|dlc| matches!(dlc.status, crate::dlc::DlcStatus::Installed))
        .map(|dlc| dlc.handle)
        .collect();
    let mut ordered = Vec::new();
    for addon in addons {
        match addon.kind {
            LaunchAddonKind::Mod => {
                let requested = fs::canonicalize(&addon.value)
                    .map_err(|_| format!("addon folder is missing: {}", addon.value))?;
                if !allowed_mods.contains(&requested) {
                    return Err(format!(
                        "addon is no longer in an enabled source: {}",
                        addon.value
                    ));
                }
                ordered.push(wine_path(&requested));
            }
            LaunchAddonKind::Dlc => {
                if !allowed_dlcs.contains(&addon.value) {
                    return Err(format!("DLC is unavailable: {}", addon.value));
                }
                ordered.push(addon.value);
            }
        }
    }

    let settings = crate::launcher_options::load()?;
    let mut arguments = crate::launcher_options::arguments(&settings);
    if let Some(profile) = player_profile.filter(|value| !value.is_empty()) {
        crate::launcher_options::validate_profile(&profile)?;
        if !settings
            .player_profiles
            .iter()
            .any(|saved| saved == &profile)
        {
            return Err("the selected player profile is not saved in Configuration".into());
        }
        arguments.push(format!("-name={profile}"));
    }
    if let Some(server_id) = selected_server_id.as_deref() {
        let server = settings
            .servers
            .iter()
            .find(|server| server.id == server_id)
            .ok_or_else(|| "the selected server no longer exists".to_owned())?;
        arguments.push(format!("-connect={}", server.address));
        arguments.push(format!("-port={}", server.port));
        if let Some(password) = server.password.as_deref() {
            arguments.push(format!("-password={password}"));
        }
    }
    if !ordered.is_empty() {
        arguments.push(format!("-mod={}", ordered.join(";")));
    }
    ensure_steam_running()?;
    let log_dir = user_home()?.join(".local/state/armasync/logs");
    fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let log = log_dir.join("arma-launch.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
        .map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let mut child = crate::process::host_command("protontricks-launch")
        .args(["--appid", "107410"])
        .arg(&executable)
        .args(arguments)
        .current_dir(&installation.game_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| error.to_string())?;
    std::thread::sleep(Duration::from_millis(1500));
    if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
        return Err(format!(
            "Arma exited during startup with {status}; diagnostic log: {}",
            log.display()
        ));
    }
    Ok(ProcessLaunchResult {
        process_id: child.id(),
        log_file: log.to_string_lossy().into_owned(),
    })
}

fn ensure_steam_running() -> Result<(), String> {
    if process_running("steam") {
        return Ok(());
    }
    crate::process::host_command("steam")
        .arg("-silent")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("could not start Steam: {error}"))?;
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(500));
        if process_running("steam") {
            return Ok(());
        }
    }
    Err("Steam did not become ready within 10 seconds".into())
}
fn process_running(name: &str) -> bool {
    fs::read_dir("/proc")
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .bytes()
                .all(|byte| byte.is_ascii_digit())
                && fs::read(entry.path().join("comm"))
                    .ok()
                    .is_some_and(|data| {
                        String::from_utf8_lossy(&data)
                            .trim()
                            .eq_ignore_ascii_case(name)
                    })
        })
}
fn command_exists(name: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|path| path.join(name).is_file()))
}
fn wine_path(path: &Path) -> String {
    format!("Z:{}", path.to_string_lossy().replace('/', "\\"))
}
fn user_home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_owned())
}

#[cfg(test)]
mod tests {
    use super::wine_path;
    use std::path::Path;
    #[test]
    fn translates_linux_paths_for_proton() {
        assert_eq!(
            wine_path(Path::new("/mnt/Games/Arma 3/@CBA_A3")),
            "Z:\\mnt\\Games\\Arma 3\\@CBA_A3"
        );
    }
}

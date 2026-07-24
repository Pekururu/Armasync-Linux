use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use walkdir::WalkDir;

use crate::model::{
    InstallerLaunchResult, PluginInstallResult, ProcessLaunchResult, RuntimeComponentResult,
    RuntimeSetupResult, VoiceRuntimeComponent, VoiceStatus,
};

const APP_ID: &str = "107410";
const TS_VERSION: &str = "3.6.2";
const TS_URL: &str =
    "https://files.teamspeak-services.com/releases/client/3.6.2/TeamSpeak3-Client-win64-3.6.2.exe";
const MAX_INSTALLER_BYTES: u64 = 250 * 1024 * 1024;
const DARK_THEME_NAME: &str = "Arma Launcher Dark.qss";
const DARK_THEME: &str = include_str!("../assets/armalauncher-dark.qss");
const RUNTIMES: [(&str, &str); 5] = [
    ("d3dcompiler_43", "D3D Compiler 43"),
    ("d3dx10_43", "Direct3D 10 helper"),
    ("d3dx11_43", "Direct3D 11 helper"),
    ("xact_x64", "XACT 64-bit audio"),
    ("xaudio29", "XAudio 2.9"),
];

pub fn status() -> VoiceStatus {
    let installation = crate::steam::discover_arma();
    let game_directory = installation
        .as_ref()
        .map(|item| item.game_directory.clone());
    let prefix_directory = installation
        .as_ref()
        .map(|item| item.prefix_directory.clone());
    let prefix_initialized = prefix_directory
        .as_ref()
        .is_some_and(|path| path.join("pfx/drive_c").is_dir());
    let teamspeak_executable = prefix_directory
        .as_ref()
        .and_then(|path| teamspeak_exe(path));
    let plugin_directory = teamspeak_executable
        .as_ref()
        .and_then(|path| path.parent())
        .map(|path| path.join("plugins"));

    let discovered = crate::sources::catalog().unwrap_or_default();
    let acre_directory = find_catalog_mod(&discovered, "acre2").or_else(|| {
        game_directory
            .as_ref()
            .and_then(|path| find_game_mod(path, "acre2"))
    });
    let cba_directory = find_catalog_mod(&discovered, "cba_a3").or_else(|| {
        game_directory
            .as_ref()
            .and_then(|path| find_game_mod(path, "cba_a3"))
    });
    let acre_plugin_source = acre_directory.as_ref().and_then(|directory| {
        WalkDir::new(directory)
            .max_depth(8)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .find(|entry| entry.file_type().is_file() && is_acre_plugin(entry.path()))
            .map(walkdir::DirEntry::into_path)
    });
    let acre_plugin_destination = match (&plugin_directory, &acre_plugin_source) {
        (Some(directory), Some(source)) => source.file_name().map(|name| directory.join(name)),
        _ => None,
    };
    let acre_plugin_installed = acre_plugin_destination
        .as_ref()
        .is_some_and(|path| path.is_file());
    let dark_theme_path = prefix_directory.as_deref().map(dark_theme_path);
    let dark_theme_installed = dark_theme_path.as_ref().is_some_and(|path| path.is_file());
    let protontricks_available = command_exists("protontricks");
    let protontricks_launch_available = command_exists("protontricks-launch");
    let pipewire_available = crate::process::host_command("wpctl")
        .arg("status")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    let audio_input = pipewire_device("@DEFAULT_AUDIO_SOURCE@");
    let audio_output = pipewire_device("@DEFAULT_AUDIO_SINK@");
    let teamspeak_running = process_running("ts3client_win64.exe");
    let runtime_components = runtime_status(prefix_directory.as_deref());

    let mut notes = Vec::new();
    if !prefix_initialized {
        notes.push("Launch Arma 3 once to initialize its Proton prefix.".into());
    }
    if !protontricks_available || !protontricks_launch_available {
        notes.push(
            "Install protontricks: pacman -S protontricks (provides protontricks-launch).".into(),
        );
    }
    if teamspeak_executable.is_none() {
        notes.push("Install Windows TeamSpeak 3.6.2 for all users in Arma's prefix.".into());
    }
    if acre_directory.is_none() {
        notes.push("ACRE2 was not found in the configured addon sources.".into());
    }
    if cba_directory.is_none() {
        notes.push("CBA_A3 was not found; ACRE2 requires it.".into());
    }
    if acre_plugin_source.is_some() && !acre_plugin_installed {
        notes.push("Install the ACRE2 64-bit TeamSpeak plugin.".into());
    }
    if !pipewire_available {
        notes.push(
            "Install PipeWire audio: pacman -S wireplumber pipewire pipewire-pulse.".into(),
        );
    }
    let ready = prefix_initialized
        && protontricks_launch_available
        && pipewire_available
        && plugin_directory.is_some()
        && cba_directory.is_some()
        && acre_directory.is_some()
        && acre_plugin_installed;

    VoiceStatus {
        game_directory: display(game_directory),
        prefix_directory: display(prefix_directory),
        prefix_initialized,
        protontricks_available,
        protontricks_launch_available,
        pipewire_available,
        audio_input,
        audio_output,
        teamspeak_executable: display(teamspeak_executable),
        teamspeak_installed: plugin_directory.is_some(),
        teamspeak_running,
        plugin_directory: display(plugin_directory),
        acre_directory: display(acre_directory),
        cba_directory: display(cba_directory),
        acre_plugin_source: display(acre_plugin_source),
        acre_plugin_installed,
        acre_plugin_destination: display(acre_plugin_destination),
        dark_theme_installed,
        dark_theme_path: display(dark_theme_path),
        runtime_components,
        ready,
        notes,
    }
}

pub fn teamspeak_running() -> bool {
    process_running("ts3client_win64.exe")
}

pub async fn prepare_runtime() -> Result<RuntimeSetupResult, String> {
    let prefix = initialized_prefix()?;
    let backup = tokio::task::spawn_blocking({
        let prefix = prefix.clone();
        move || backup_prefix(&prefix, "before-voice-runtime")
    })
    .await
    .map_err(|error| error.to_string())??;
    let log = log_path("voice-runtime.log")?;
    let log_for_task = log.clone();
    let components = tokio::task::spawn_blocking(move || install_runtimes(&log_for_task))
        .await
        .map_err(|error| error.to_string())??;
    let success = components.iter().all(|item| item.success);
    Ok(RuntimeSetupResult {
        backup_archive: path_string(backup),
        log_file: path_string(log),
        components,
        success,
    })
}

pub async fn install_mfc140() -> Result<RuntimeSetupResult, String> {
    let prefix = initialized_prefix()?;
    let backup = tokio::task::spawn_blocking({
        let prefix = prefix.clone();
        move || backup_prefix(&prefix, "before-mfc140")
    })
    .await
    .map_err(|error| error.to_string())??;
    let log = log_path("mfc140-repair.log")?;
    let log_for_task = log.clone();
    let component = tokio::task::spawn_blocking(move || {
        let output = crate::process::host_command("protontricks")
            .args(winetricks_args("mfc140"))
            .output()
            .map_err(|error| error.to_string())?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&log_for_task)
            .map_err(|error| error.to_string())?;
        file.write_all(&output.stdout)
            .and_then(|_| file.write_all(&output.stderr))
            .and_then(|_| file.sync_all())
            .map_err(|error| error.to_string())?;
        let detail = if output.status.success() {
            "Repair installed successfully".into()
        } else {
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("Repair failed; open the log for details")
                .trim()
                .to_owned()
        };
        Ok::<_, String>(RuntimeComponentResult {
            id: "mfc140".into(),
            label: "ACRE VC140 repair".into(),
            success: output.status.success(),
            detail,
        })
    })
    .await
    .map_err(|error| error.to_string())??;
    let success = component.success;
    Ok(RuntimeSetupResult {
        backup_archive: path_string(backup),
        log_file: path_string(log),
        components: vec![component],
        success,
    })
}

fn install_runtimes(log_path: &Path) -> Result<Vec<RuntimeComponentResult>, String> {
    let mut log = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(log_path)
        .map_err(|error| error.to_string())?;
    writeln!(log, "Arma Launcher voice runtime setup — {}", timestamp()?)
        .map_err(|error| error.to_string())?;
    let mut results = Vec::new();
    for (id, label) in RUNTIMES {
        writeln!(log, "\n===== {id} =====").map_err(|error| error.to_string())?;
        let output = crate::process::host_command("protontricks")
            .args(winetricks_args(id))
            .output()
            .map_err(|error| error.to_string())?;
        log.write_all(&output.stdout)
            .and_then(|_| log.write_all(&output.stderr))
            .map_err(|error| error.to_string())?;
        let detail = if output.status.success() {
            "Installed successfully".to_owned()
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            stderr
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("Protontricks failed without a diagnostic message")
                .trim()
                .to_owned()
        };
        let success = output.status.success();
        results.push(RuntimeComponentResult {
            id: id.into(),
            label: label.into(),
            success,
            detail,
        });
        if !success {
            break;
        }
    }
    log.sync_all().map_err(|error| error.to_string())?;
    Ok(results)
}

fn winetricks_args(verb: &str) -> [&str; 3] {
    // Everything after APP_ID is passed through to Winetricks. In particular,
    // `-q` is a Winetricks option, not a Protontricks option.
    [APP_ID, "-q", verb]
}

pub async fn install_teamspeak() -> Result<InstallerLaunchResult, String> {
    let prefix = initialized_prefix()?;
    if !command_exists("protontricks-launch") {
        return Err("protontricks-launch is not available on PATH".into());
    }
    let backup = tokio::task::spawn_blocking({
        let prefix = prefix.clone();
        move || backup_prefix(&prefix, "before-teamspeak")
    })
    .await
    .map_err(|error| error.to_string())??;
    let installer = download_installer().await?;
    let log = log_path("teamspeak-installer.log")?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
        .map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let child = crate::process::host_command("protontricks-launch")
        .args(["--appid", APP_ID])
        .arg(&installer)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(InstallerLaunchResult {
        process_id: child.id(),
        backup_archive: path_string(backup),
        installer: path_string(installer),
        log_file: path_string(log),
    })
}

pub fn install_acre_plugin() -> Result<PluginInstallResult, String> {
    let current = status();
    if current.teamspeak_running {
        return Err("Exit TeamSpeak completely before replacing its ACRE2 plugin".into());
    }
    if current.cba_directory.is_none() {
        return Err("CBA_A3 was not found; ACRE2 requires it".into());
    }
    let source = current
        .acre_plugin_source
        .map(PathBuf::from)
        .ok_or_else(|| "No 64-bit ACRE2 TeamSpeak plugin was found".to_owned())?;
    let destination = current
        .acre_plugin_destination
        .map(PathBuf::from)
        .ok_or_else(|| "TeamSpeak 3 is not installed for all users in Arma's prefix".to_owned())?;
    let parent = destination
        .parent()
        .ok_or_else(|| "invalid TeamSpeak plugin path".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let backup = if destination.exists() {
        let path = destination.with_extension(format!("dll.backup-{}", timestamp()?));
        fs::copy(&destination, &path).map_err(|error| error.to_string())?;
        Some(path)
    } else {
        None
    };
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    Ok(PluginInstallResult {
        destination: path_string(destination),
        backup: display(backup),
    })
}

pub fn launch_teamspeak() -> Result<ProcessLaunchResult, String> {
    let current = status();
    let executable = current
        .teamspeak_executable
        .ok_or_else(|| "Windows TeamSpeak 3.6.2 is not installed in Arma's prefix".to_owned())?;
    if !command_exists("protontricks-launch") {
        return Err("protontricks-launch is not available on PATH".into());
    }
    let log = log_path("teamspeak-launch.log")?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log)
        .map_err(|error| error.to_string())?;
    let stderr = stdout.try_clone().map_err(|error| error.to_string())?;
    let child = crate::process::host_command("protontricks-launch")
        .args(["--appid", APP_ID, &executable])
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(ProcessLaunchResult {
        process_id: child.id(),
        log_file: path_string(log),
    })
}

pub fn install_dark_theme() -> Result<PluginInstallResult, String> {
    let prefix = initialized_prefix()?;
    let destination = dark_theme_path(&prefix);
    let parent = destination
        .parent()
        .ok_or_else(|| "invalid TeamSpeak style path".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let backup = if destination.exists() {
        let path = destination.with_extension(format!("qss.backup-{}", timestamp()?));
        fs::copy(&destination, &path).map_err(|error| error.to_string())?;
        Some(path)
    } else {
        None
    };
    let temporary = destination.with_extension("qss.tmp");
    fs::write(&temporary, DARK_THEME).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    Ok(PluginInstallResult {
        destination: path_string(destination),
        backup: display(backup),
    })
}

pub fn remove_dark_theme() -> Result<PluginInstallResult, String> {
    let prefix = initialized_prefix()?;
    let destination = dark_theme_path(&prefix);
    if !destination.is_file() {
        return Err("Arma Launcher Dark is not installed".into());
    }
    let backup = destination.with_extension(format!("qss.removed-{}", timestamp()?));
    fs::rename(&destination, &backup).map_err(|error| error.to_string())?;
    Ok(PluginInstallResult {
        destination: path_string(destination),
        backup: Some(path_string(backup)),
    })
}

fn runtime_status(prefix: Option<&Path>) -> Vec<VoiceRuntimeComponent> {
    let installed = prefix
        .and_then(|path| fs::read_to_string(path.join("pfx/winetricks.log")).ok())
        .unwrap_or_default();
    RUNTIMES
        .into_iter()
        .map(|(id, label)| VoiceRuntimeComponent {
            id: id.into(),
            label: label.into(),
            installed: installed.lines().any(|line| line.trim() == id),
        })
        .collect()
}

fn initialized_prefix() -> Result<PathBuf, String> {
    crate::steam::discover_arma()
        .map(|item| item.prefix_directory)
        .filter(|path| path.join("pfx/drive_c").is_dir())
        .ok_or_else(|| "Arma's Proton prefix is not initialized".to_owned())
}

fn teamspeak_exe(prefix: &Path) -> Option<PathBuf> {
    [
        "pfx/drive_c/Program Files/TeamSpeak 3 Client/ts3client_win64.exe",
        "pfx/drive_c/Program Files (x86)/TeamSpeak 3 Client/ts3client_win64.exe",
    ]
    .into_iter()
    .map(|path| prefix.join(path))
    .find(|path| path.is_file())
}

fn dark_theme_path(prefix: &Path) -> PathBuf {
    prefix
        .join("pfx/drive_c/users/steamuser/AppData/Roaming/TS3Client/styles")
        .join(DARK_THEME_NAME)
}

fn find_catalog_mod(addons: &[crate::sources::DiscoveredAddon], needle: &str) -> Option<PathBuf> {
    addons
        .iter()
        .find(|addon| {
            format!("{} {}", addon.name, addon.folder)
                .to_ascii_lowercase()
                .contains(needle)
        })
        .map(|addon| PathBuf::from(&addon.path))
}

fn find_game_mod(game: &Path, needle: &str) -> Option<PathBuf> {
    fs::read_dir(game)
        .ok()?
        .filter_map(Result::ok)
        .find(|entry| {
            entry.path().is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains(needle)
        })
        .map(|entry| entry.path())
}

fn is_acre_plugin(path: &Path) -> bool {
    matches!(
        path.file_name()
            .and_then(|name| name.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("acre2_win64.dll" | "acre2_win64.ts3_plugin")
    )
}

fn process_running(needle: &str) -> bool {
    let needle = needle.to_ascii_lowercase();
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
                && fs::read(entry.path().join("cmdline"))
                    .ok()
                    .is_some_and(|bytes| {
                        String::from_utf8_lossy(&bytes)
                            .to_ascii_lowercase()
                            .contains(&needle)
                    })
        })
}

fn command_exists(name: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|path| path.join(name).is_file()))
}

fn backup_prefix(prefix: &Path, label: &str) -> Result<PathBuf, String> {
    let compatdata = prefix
        .parent()
        .ok_or_else(|| "invalid prefix location".to_owned())?;
    let root = compatdata.join(".armalauncher-backups");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let archive = root.join(format!("107410-pfx-{label}-{}.tar.zst", timestamp()?));
    let status = crate::process::host_command("tar")
        .args(["--zstd", "-C"])
        .arg(prefix)
        .arg("-cf")
        .arg(&archive)
        .arg("pfx")
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!(
            "prefix backup failed with {status}; no changes were made"
        ));
    }
    Ok(archive)
}

async fn download_installer() -> Result<PathBuf, String> {
    let cache = user_home()?.join(".cache/armalauncher");
    fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    let installer = cache.join(format!("TeamSpeak3-Client-win64-{TS_VERSION}.exe"));
    if valid_pe_installer(&installer) {
        return Ok(installer);
    }
    let part = installer.with_extension("exe.part");
    let mut response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?
        .get(TS_URL)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_INSTALLER_BYTES)
    {
        return Err("TeamSpeak installer exceeds the safe download size".into());
    }
    let mut file = fs::File::create(&part).map_err(|error| error.to_string())?;
    let mut total = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        total += chunk.len() as u64;
        if total > MAX_INSTALLER_BYTES {
            let _ = fs::remove_file(&part);
            return Err("TeamSpeak installer exceeds the safe download size".into());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
    }
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&part, &installer).map_err(|error| error.to_string())?;
    if !valid_pe_installer(&installer) {
        let _ = fs::remove_file(&installer);
        return Err("downloaded TeamSpeak installer is not a valid Windows executable".into());
    }
    Ok(installer)
}

fn valid_pe_installer(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut magic = [0_u8; 2];
    use std::io::Read;
    file.read_exact(&mut magic).is_ok()
        && magic == *b"MZ"
        && file
            .metadata()
            .is_ok_and(|metadata| metadata.len() > 1024 * 1024)
}

fn pipewire_device(target: &str) -> Option<String> {
    let output = crate::process::host_command("wpctl")
        .args(["inspect", target])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let value = line.trim().strip_prefix("* node.description = ")?;
            Some(value.trim_matches('"').to_owned())
        })
}

fn log_path(name: &str) -> Result<PathBuf, String> {
    let directory = user_home()?.join(".local/state/armalauncher/logs");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(name))
}

fn user_home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_owned())
}
fn timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| error.to_string())
}
fn display(path: Option<PathBuf>) -> Option<String> {
    path.map(path_string)
}
fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_winetricks_options_after_the_app_id() {
        assert_eq!(
            winetricks_args("d3dcompiler_43"),
            ["107410", "-q", "d3dcompiler_43"]
        );
    }
}

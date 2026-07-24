use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

use crate::model::{
    DiagnosticCheck, DiagnosticLog, DiagnosticPath, DiagnosticReport, DiagnosticStatus,
    PrefixBackup, SupportBundle,
};

pub fn report() -> DiagnosticReport {
    let installation = crate::steam::discover_arma();
    let voice = crate::voice::status();
    let mut checks = Vec::new();
    checks.push(simple_check(
        "arma",
        "Arma 3",
        installation.is_some(),
        "Game detected",
        "Arma 3 could not be found",
        installation
            .as_ref()
            .map(|item| display(&item.game_directory))
            .unwrap_or_default(),
    ));
    let prefix_ready = installation
        .as_ref()
        .is_some_and(|item| item.prefix_directory.join("pfx/drive_c").is_dir());
    checks.push(simple_check(
        "prefix",
        "Compatibility environment",
        prefix_ready,
        "Ready",
        "Launch Arma once to finish setup",
        installation
            .as_ref()
            .map(|item| display(&item.prefix_directory))
            .unwrap_or_default(),
    ));
    checks.push(command_check("protontricks", "Compatibility tools"));
    checks.push(vulkan_check());
    checks.push(simple_check(
        "audio",
        "Audio",
        voice.pipewire_available,
        "PipeWire is ready",
        "PipeWire is unavailable",
        format!(
            "Input: {} · Output: {}",
            voice.audio_input.as_deref().unwrap_or("unknown"),
            voice.audio_output.as_deref().unwrap_or("unknown")
        ),
    ));
    checks.push(DiagnosticCheck {
        id: "proton".into(),
        label: "Proton version".into(),
        status: if crate::steam::selected_proton().is_some() {
            DiagnosticStatus::Pass
        } else {
            DiagnosticStatus::Warning
        },
        summary: crate::steam::selected_proton().unwrap_or_else(|| "Not forced in Steam".into()),
        detail: "Steam controls the compatibility tool used for Arma 3.".into(),
    });
    let sources = crate::sources::list().unwrap_or_default();
    let usable_sources = sources
        .iter()
        .filter(|source| {
            source.enabled && matches!(source.status, crate::sources::SourceStatus::Ready)
        })
        .count();
    checks.push(DiagnosticCheck {
        id: "sources".into(),
        label: "Addon sources".into(),
        status: if usable_sources > 0 {
            DiagnosticStatus::Pass
        } else {
            DiagnosticStatus::Warning
        },
        summary: format!("{usable_sources} ready"),
        detail: format!("{} configured addon search directories", sources.len()),
    });
    checks.push(DiagnosticCheck {
        id: "voice".into(),
        label: "ACRE voice integration".into(),
        status: if voice.ready {
            DiagnosticStatus::Pass
        } else {
            DiagnosticStatus::Warning
        },
        summary: if voice.ready {
            "Ready".into()
        } else {
            "Setup incomplete".into()
        },
        detail: voice.notes.join(" "),
    });
    if let Some(item) = installation.as_ref() {
        checks.push(space_check(&item.game_directory));
    }
    checks.push(graphics_workaround_check());

    DiagnosticReport {
        paths: paths(installation.as_ref()),
        logs: logs(installation.as_ref()),
        backups: backups(installation.as_ref()),
        checks,
    }
}

pub fn collect_support_bundle() -> Result<SupportBundle, String> {
    let stamp = timestamp()?;
    let state = state_dir()?;
    let staging = state.join(format!("support-staging-{stamp}-{}", std::process::id()));
    let downloads = user_home()?.join("Downloads");
    let output_dir = if downloads.is_dir() {
        downloads
    } else {
        state.clone()
    };
    let archive = output_dir.join(format!("armasync-support-{stamp}.tar.zst"));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let result = (|| {
        let report = report();
        write(
            &staging.join("diagnostics.json"),
            serde_json::to_vec_pretty(&report)
                .map_err(|error| error.to_string())?
                .as_slice(),
        )?;
        let mut included = 1;
        for log in &report.logs {
            let source = Path::new(&log.path);
            if source.is_file() {
                fs::copy(source, staging.join(safe_name(&log.name)))
                    .map_err(|error| error.to_string())?;
                included += 1;
            }
        }
        let config_dir = user_home()?.join(".config/armasync");
        let settings = config_dir.join("launcher.toml");
        if settings.is_file() {
            let input = fs::read_to_string(&settings).map_err(|error| error.to_string())?;
            let mut redacted: crate::launcher_options::LauncherSettings =
                toml::from_str(&input).map_err(|error| error.to_string())?;
            for server in &mut redacted.servers {
                server.password = server.password.as_ref().map(|_| "<redacted>".into());
            }
            let output = toml::to_string_pretty(&redacted).map_err(|error| error.to_string())?;
            write(&staging.join("launcher-settings.toml"), output.as_bytes())?;
            included += 1;
        }
        let addon_groups = config_dir.join("addon-groups.toml");
        if addon_groups.is_file() {
            fs::copy(addon_groups, staging.join("addon-groups.toml"))
                .map_err(|error| error.to_string())?;
            included += 1;
        }
        let parent = staging
            .parent()
            .ok_or_else(|| "invalid support staging path".to_owned())?;
        let name = staging
            .file_name()
            .ok_or_else(|| "invalid support staging path".to_owned())?;
        let status = crate::process::host_command("tar")
            .args(["--zstd", "-C"])
            .arg(parent)
            .arg("-cf")
            .arg(&archive)
            .arg(name)
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!("support archive creation failed with {status}"));
        }
        Ok(SupportBundle {
            archive: display(&archive),
            included_files: included,
        })
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

fn paths(installation: Option<&crate::steam::ArmaInstallation>) -> Vec<DiagnosticPath> {
    let mut result = Vec::new();
    if let Some(item) = installation {
        result.push(path_item(
            "game",
            "Arma installation",
            item.game_directory.clone(),
        ));
        result.push(path_item(
            "prefix",
            "Compatibility files",
            item.prefix_directory.clone(),
        ));
        let profiles = item
            .prefix_directory
            .join("pfx/drive_c/users/steamuser/Documents/Arma 3");
        result.push(path_item("profiles", "Arma profiles", profiles));
    }
    if let Ok(path) = state_dir() {
        result.push(path_item("logs", "Launcher logs", path.join("logs")));
    }
    result
}

fn logs(installation: Option<&crate::steam::ArmaInstallation>) -> Vec<DiagnosticLog> {
    let mut files = Vec::new();
    if let Ok(directory) = state_dir().map(|path| path.join("logs"))
        && let Ok(entries) = fs::read_dir(directory)
    {
        files.extend(
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_file()),
        );
    }
    if let Some(item) = installation
        && let Some(rpt) = newest_rpt(&item.prefix_directory)
    {
        files.push(rpt);
    }
    let mut result = files
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            Some(DiagnosticLog {
                name: path.file_name()?.to_string_lossy().into_owned(),
                path: display(&path),
                modified: modified(&metadata),
                size: metadata.len(),
            })
        })
        .collect::<Vec<_>>();
    result.sort_by_key(|item| std::cmp::Reverse(item.modified));
    result.truncate(12);
    result
}

fn backups(installation: Option<&crate::steam::ArmaInstallation>) -> Vec<PrefixBackup> {
    let Some(item) = installation else {
        return Vec::new();
    };
    let Some(parent) = item.prefix_directory.parent() else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for directory in [
        parent.join(".armasync-backups"),
        parent.join(".lowtac-linux-backups"),
    ] {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for path in entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
        {
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            let Some(name) = path.file_name() else {
                continue;
            };
            result.push(PrefixBackup {
                name: name.to_string_lossy().into_owned(),
                path: display(&path),
                size: metadata.len(),
                modified: modified(&metadata),
            });
        }
    }
    result.sort_by_key(|item| std::cmp::Reverse(item.modified));
    result
}

fn newest_rpt(prefix: &Path) -> Option<PathBuf> {
    WalkDir::new(prefix.join("pfx/drive_c/users"))
        .max_depth(8)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("rpt"))
        })
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.into_path())))
        .max_by_key(|(time, _)| *time)
        .map(|(_, path)| path)
}

fn vulkan_check() -> DiagnosticCheck {
    match crate::process::host_command("vulkaninfo")
        .arg("--summary")
        .output()
    {
        Ok(output) if output.status.success() => {
            let detail = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find(|line| line.trim_start().starts_with("deviceName"))
                .unwrap_or("Vulkan initialized")
                .trim()
                .to_owned();
            DiagnosticCheck {
                id: "vulkan".into(),
                label: "Graphics renderer".into(),
                status: DiagnosticStatus::Pass,
                summary: "Vulkan ready".into(),
                detail,
            }
        }
        Ok(output) => DiagnosticCheck {
            id: "vulkan".into(),
            label: "Graphics renderer".into(),
            status: DiagnosticStatus::Fail,
            summary: "Vulkan failed".into(),
            detail: String::from_utf8_lossy(&output.stderr)
                .lines()
                .next()
                .unwrap_or("vulkaninfo failed")
                .into(),
        },
        Err(error) => DiagnosticCheck {
            id: "vulkan".into(),
            label: "Graphics renderer".into(),
            status: DiagnosticStatus::Fail,
            summary: "Vulkan check unavailable".into(),
            detail: error.to_string(),
        },
    }
}

fn graphics_workaround_check() -> DiagnosticCheck {
    let nvidia = Path::new("/proc/driver/nvidia/version").is_file();
    DiagnosticCheck {
        id: "display".into(),
        label: "Launcher display".into(),
        status: DiagnosticStatus::Pass,
        summary: if nvidia {
            "NVIDIA workaround active".into()
        } else {
            "Native rendering".into()
        },
        detail: if nvidia {
            "WebKit DMA-BUF import is disabled to avoid the recorded Wayland protocol error.".into()
        } else {
            "No NVIDIA-specific WebKit workaround is required.".into()
        },
    }
}

fn space_check(path: &Path) -> DiagnosticCheck {
    match fs2::available_space(path) {
        Ok(value) => DiagnosticCheck {
            id: "space".into(),
            label: "Free storage".into(),
            status: if value > 20 * 1024 * 1024 * 1024 {
                DiagnosticStatus::Pass
            } else {
                DiagnosticStatus::Warning
            },
            summary: format!("{} available", bytes(value)),
            detail: display(path),
        },
        Err(error) => DiagnosticCheck {
            id: "space".into(),
            label: "Free storage".into(),
            status: DiagnosticStatus::Warning,
            summary: "Could not check".into(),
            detail: error.to_string(),
        },
    }
}

fn command_check(command: &str, label: &str) -> DiagnosticCheck {
    let found = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(command))
            .find(|path| path.is_file())
    });
    simple_check(
        command,
        label,
        found.is_some(),
        "Installed",
        "Not installed",
        found.as_ref().map(|path| display(path)).unwrap_or_default(),
    )
}
fn simple_check(
    id: &str,
    label: &str,
    passed: bool,
    yes: &str,
    no: &str,
    detail: String,
) -> DiagnosticCheck {
    DiagnosticCheck {
        id: id.into(),
        label: label.into(),
        status: if passed {
            DiagnosticStatus::Pass
        } else {
            DiagnosticStatus::Fail
        },
        summary: if passed { yes.into() } else { no.into() },
        detail,
    }
}
fn path_item(id: &str, label: &str, path: PathBuf) -> DiagnosticPath {
    DiagnosticPath {
        id: id.into(),
        label: label.into(),
        available: path.is_dir(),
        path: display(&path),
    }
}
fn modified(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}
fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || ".-_".contains(character) {
                character
            } else {
                '_'
            }
        })
        .collect()
}
fn bytes(value: u64) -> String {
    if value >= 1024_u64.pow(3) {
        format!("{:.1} GB", value as f64 / 1024_f64.powi(3))
    } else {
        format!("{:.0} MB", value as f64 / 1024_f64.powi(2))
    }
}
fn write(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(path).map_err(|error| error.to_string())?;
    file.write_all(data)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())
}
fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
fn user_home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_owned())
}
fn state_dir() -> Result<PathBuf, String> {
    Ok(user_home()?.join(".local/state/armasync"))
}
fn timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| error.to_string())
}

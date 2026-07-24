mod addon_groups;
mod diagnostics;
mod dlc;
mod game_launch;
mod launch_selection;
pub(crate) mod launcher_options;
mod model;
mod process;
mod repository;
mod repository_store;
mod sources;
mod steam;
mod voice;

use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn list_addon_groups() -> Result<Vec<addon_groups::AddonGroup>, String> {
    addon_groups::list()
}

#[tauri::command]
fn save_addon_groups(
    groups: Vec<addon_groups::AddonGroup>,
) -> Result<Vec<addon_groups::AddonGroup>, String> {
    addon_groups::save(groups)
}

#[tauri::command]
fn detect_dlc() -> dlc::DlcDetection {
    dlc::detect()
}

#[tauri::command]
fn list_addon_sources() -> Result<Vec<sources::AddonSource>, String> {
    sources::list()
}

#[tauri::command]
fn add_addon_source(path: String) -> Result<Vec<sources::AddonSource>, String> {
    sources::add(&path)
}

#[tauri::command]
fn add_steam_workshop_source() -> Result<Vec<sources::AddonSource>, String> {
    sources::add_workshop()
}

#[tauri::command]
fn scan_addon_catalog() -> Result<Vec<sources::DiscoveredAddon>, String> {
    sources::catalog()
}

#[tauri::command]
fn set_addon_source_enabled(
    id: String,
    enabled: bool,
) -> Result<Vec<sources::AddonSource>, String> {
    sources::set_enabled(&id, enabled)
}

#[tauri::command]
fn remove_addon_source(id: String) -> Result<Vec<sources::AddonSource>, String> {
    sources::remove(&id)
}

#[tauri::command]
fn reorder_addon_sources(ids: Vec<String>) -> Result<Vec<sources::AddonSource>, String> {
    sources::reorder(&ids)
}

#[tauri::command]
fn get_launch_selection() -> Result<launch_selection::LaunchSelection, String> {
    launch_selection::load()
}

#[tauri::command]
fn save_launch_selection(
    selection: launch_selection::LaunchSelection,
) -> Result<launch_selection::LaunchSelection, String> {
    launch_selection::save(selection)
}

#[tauri::command]
fn list_repositories() -> Result<Vec<repository_store::SavedRepository>, String> {
    repository_store::list()
}

#[tauri::command]
async fn import_repository(
    autoconfig_url: String,
    destination: String,
) -> Result<Vec<repository_store::SavedRepository>, String> {
    let parsed = url::Url::parse(&autoconfig_url)
        .map_err(|error| format!("invalid auto-config URL: {error}"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("credentials may not be embedded in a saved auto-config URL".into());
    }
    let snapshot = repository::inspect(&autoconfig_url)
        .await
        .map_err(|error| error.to_string())?;
    repository_store::add(snapshot.repository.name, autoconfig_url, destination)
}

#[tauri::command]
async fn connect_repository(id: String) -> Result<model::RepositorySnapshot, String> {
    let saved = repository_store::get(&id)?;
    repository::inspect(&saved.autoconfig_url)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_repository_destination(
    id: String,
    destination: String,
) -> Result<Vec<repository_store::SavedRepository>, String> {
    repository_store::update(&id, destination)
}

#[tauri::command]
fn remove_repository(id: String) -> Result<Vec<repository_store::SavedRepository>, String> {
    repository_store::remove(&id)
}

#[tauri::command]
async fn check_repository_files(
    id: String,
    selected_addons: Vec<String>,
) -> Result<model::SyncPlan, String> {
    let saved = repository_store::get(&id)?;
    repository::plan_sync(
        &saved.autoconfig_url,
        selected_addons,
        PathBuf::from(saved.destination),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn synchronize_repository(
    id: String,
    selected_addons: Vec<String>,
    job_id: String,
    on_progress: tauri::ipc::Channel<model::SyncProgress>,
    coordinator: tauri::State<'_, repository::SyncCoordinator>,
) -> Result<model::SyncResult, String> {
    let saved = repository_store::get(&id)?;
    let control = coordinator.begin(job_id.clone())?;
    let result = repository::execute_sync(
        &saved.autoconfig_url,
        selected_addons,
        PathBuf::from(saved.destination),
        control,
        move |progress| {
            let _ = on_progress.send(progress);
        },
    )
    .await
    .map_err(|error| error.to_string());
    coordinator.finish(&job_id);
    result
}

#[tauri::command]
fn pause_repository_sync(
    job_id: String,
    coordinator: tauri::State<'_, repository::SyncCoordinator>,
) -> Result<(), String> {
    coordinator.control(&job_id)?.pause();
    Ok(())
}

#[tauri::command]
fn resume_repository_sync(
    job_id: String,
    coordinator: tauri::State<'_, repository::SyncCoordinator>,
) -> Result<(), String> {
    coordinator.control(&job_id)?.resume();
    Ok(())
}

#[tauri::command]
fn stop_repository_sync(
    job_id: String,
    coordinator: tauri::State<'_, repository::SyncCoordinator>,
) -> Result<(), String> {
    coordinator.control(&job_id)?.cancel();
    Ok(())
}

#[tauri::command]
fn get_voice_status() -> model::VoiceStatus {
    voice::status()
}

#[tauri::command]
async fn prepare_voice_runtime() -> Result<model::RuntimeSetupResult, String> {
    voice::prepare_runtime().await
}

#[tauri::command]
async fn install_teamspeak() -> Result<model::InstallerLaunchResult, String> {
    voice::install_teamspeak().await
}

#[tauri::command]
fn install_acre_plugin() -> Result<model::PluginInstallResult, String> {
    voice::install_acre_plugin()
}

#[tauri::command]
fn launch_teamspeak() -> Result<model::ProcessLaunchResult, String> {
    voice::launch_teamspeak()
}

#[tauri::command]
fn get_teamspeak_running() -> bool {
    voice::teamspeak_running()
}

#[tauri::command]
fn install_teamspeak_dark_theme() -> Result<model::PluginInstallResult, String> {
    voice::install_dark_theme()
}

#[tauri::command]
fn remove_teamspeak_dark_theme() -> Result<model::PluginInstallResult, String> {
    voice::remove_dark_theme()
}

#[tauri::command]
fn get_launcher_options() -> Result<model::LauncherOptionsView, String> {
    launcher_options::view()
}

#[tauri::command]
fn save_launcher_options(
    settings: launcher_options::LauncherSettings,
) -> Result<model::LauncherOptionsView, String> {
    launcher_options::save(settings)
}

#[tauri::command]
fn preview_launcher_options(
    settings: launcher_options::LauncherSettings,
) -> Result<model::LauncherOptionsView, String> {
    launcher_options::preview(settings)
}

#[tauri::command]
fn reset_launcher_options() -> Result<model::LauncherOptionsView, String> {
    launcher_options::reset()
}

#[tauri::command]
async fn run_diagnostics() -> Result<model::DiagnosticReport, String> {
    tokio::task::spawn_blocking(diagnostics::report)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn collect_support_bundle() -> Result<model::SupportBundle, String> {
    tokio::task::spawn_blocking(diagnostics::collect_support_bundle)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_mfc140_repair() -> Result<model::RuntimeSetupResult, String> {
    voice::install_mfc140().await
}

#[tauri::command]
async fn launch_arma(
    addons: Vec<model::LaunchAddonInput>,
    selected_server_id: Option<String>,
    player_profile: Option<String>,
) -> Result<model::ProcessLaunchResult, String> {
    tokio::task::spawn_blocking(move || {
        game_launch::launch(addons, selected_server_id, player_profile)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer can terminate with a Wayland protocol
    // error on NVIDIA. This must be set before Tauri initializes GTK/WebKit.
    // Keep the native Wayland backend; only disable WebKit's problematic
    // buffer-import path on affected machines.
    #[cfg(target_os = "linux")]
    if std::path::Path::new("/proc/driver/nvidia/version").exists()
        && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
    {
        // SAFETY: Tauri has not initialized GTK or spawned application threads.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    tauri::Builder::default()
        .manage(repository::SyncCoordinator::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(icon)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_addon_groups,
            save_addon_groups,
            detect_dlc,
            list_addon_sources,
            add_addon_source,
            add_steam_workshop_source,
            scan_addon_catalog,
            set_addon_source_enabled,
            remove_addon_source,
            reorder_addon_sources,
            get_launch_selection,
            save_launch_selection,
            list_repositories,
            import_repository,
            connect_repository,
            update_repository_destination,
            remove_repository,
            check_repository_files,
            synchronize_repository,
            pause_repository_sync,
            resume_repository_sync,
            stop_repository_sync,
            get_voice_status,
            prepare_voice_runtime,
            install_teamspeak,
            install_acre_plugin,
            launch_teamspeak,
            get_teamspeak_running,
            install_teamspeak_dark_theme,
            remove_teamspeak_dark_theme,
            get_launcher_options,
            save_launcher_options,
            preview_launcher_options,
            reset_launcher_options,
            run_diagnostics,
            collect_support_bundle,
            install_mfc140_repair,
            launch_arma
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arma Launcher");
}

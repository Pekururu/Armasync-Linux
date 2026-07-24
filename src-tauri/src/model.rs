use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryInfo {
    pub name: String,
    pub protocol: String,
    pub host: String,
    pub port: Option<i32>,
    pub path: Option<String>,
    pub anonymous: bool,
    pub source_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySnapshot {
    pub repository: RepositoryInfo,
    pub manifest: ManifestSummary,
    pub published_modsets: Vec<PublishedModset>,
    pub addons: Vec<AddonCatalogEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSummary {
    pub directories: usize,
    pub files: usize,
    pub total_bytes: u64,
    pub compressed_files: usize,
    pub addon_roots: usize,
    pub unhashed_files: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedModset {
    pub name: String,
    pub description: String,
    pub addons: Vec<String>,
    pub userconfig_folders: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonCatalogEntry {
    pub id: String,
    pub name: String,
    pub remote_path: String,
    pub files: usize,
    pub total_bytes: u64,
    pub transfer_bytes: u64,
    pub duplicate_name: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub requested_addons: Vec<String>,
    pub resolved_addons: Vec<String>,
    pub missing_addons: Vec<String>,
    pub ambiguous_addons: Vec<String>,
    pub total_files: usize,
    pub verified_files: usize,
    pub download_files: usize,
    pub replacement_files: usize,
    pub download_bytes: u64,
    pub final_bytes: u64,
    pub operations: Vec<SyncPlanItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanItem {
    pub action: SyncAction,
    pub addon: String,
    pub relative_path: String,
    pub transfer_bytes: u64,
    pub final_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncAction {
    Download,
    Replace,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub installed_files: usize,
    pub downloaded_bytes: u64,
    pub backup_directory: Option<String>,
    pub destination: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncPhase {
    Preparing,
    Downloading,
    Installing,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub phase: SyncPhase,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub completed_files: usize,
    pub total_files: usize,
    pub current_file: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRuntimeComponent {
    pub id: String,
    pub label: String,
    pub installed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub game_directory: Option<String>,
    pub prefix_directory: Option<String>,
    pub prefix_initialized: bool,
    pub protontricks_available: bool,
    pub protontricks_launch_available: bool,
    pub pipewire_available: bool,
    pub audio_input: Option<String>,
    pub audio_output: Option<String>,
    pub teamspeak_executable: Option<String>,
    pub teamspeak_installed: bool,
    pub teamspeak_running: bool,
    pub plugin_directory: Option<String>,
    pub cba_directory: Option<String>,
    pub radio_plugins: Vec<RadioPluginStatus>,
    pub dark_theme_installed: bool,
    pub dark_theme_path: Option<String>,
    pub runtime_components: Vec<VoiceRuntimeComponent>,
    pub ready: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeComponentResult {
    pub id: String,
    pub label: String,
    pub success: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSetupResult {
    pub backup_archive: String,
    pub log_file: String,
    pub components: Vec<RuntimeComponentResult>,
    pub success: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerLaunchResult {
    pub process_id: u32,
    pub backup_archive: String,
    pub installer: String,
    pub log_file: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallResult {
    pub destination: String,
    pub backup: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioPluginStatus {
    pub id: String,
    pub label: String,
    pub mod_directory: Option<String>,
    pub plugin_source: Option<String>,
    pub plugin_installed: bool,
    pub plugin_destination: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioInstallResult {
    pub id: String,
    pub label: String,
    pub destination: String,
    pub backup: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLaunchResult {
    pub process_id: u32,
    pub log_file: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherEnvironment {
    pub game_directory: Option<String>,
    pub executable: Option<String>,
    pub prefix_directory: Option<String>,
    pub selected_proton: Option<String>,
    pub profiles: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherOptionsView {
    pub settings: crate::launcher_options::LauncherSettings,
    pub environment: LauncherEnvironment,
    pub arguments: Vec<String>,
    pub command_preview: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticStatus {
    Pass,
    Warning,
    Fail,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub label: String,
    pub status: DiagnosticStatus,
    pub summary: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticPath {
    pub id: String,
    pub label: String,
    pub path: String,
    pub available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticLog {
    pub name: String,
    pub path: String,
    pub modified: Option<u64>,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefixBackup {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub checks: Vec<DiagnosticCheck>,
    pub paths: Vec<DiagnosticPath>,
    pub logs: Vec<DiagnosticLog>,
    pub backups: Vec<PrefixBackup>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportBundle {
    pub archive: String,
    pub included_files: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchAddonKind {
    Mod,
    Dlc,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAddonInput {
    pub kind: LaunchAddonKind,
    pub value: String,
}

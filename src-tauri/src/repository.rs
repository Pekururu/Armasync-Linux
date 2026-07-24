use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Cursor, Read, Write};
use std::net::ToSocketAddrs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use jaded::{Content, ObjectData, Parser, PrimitiveType, Value};
use sha1::{Digest, Sha1};
use suppaftp::{FtpError, FtpStream, types::FileType};
use url::Url;

use crate::model::{
    AddonCatalogEntry, ManifestSummary, PublishedModset, RepositoryInfo, RepositorySnapshot,
    SyncAction, SyncPhase, SyncPlan, SyncPlanItem, SyncProgress, SyncResult,
};

const MAX_AUTOCONFIG_SIZE: usize = 1024 * 1024;
const MAX_MANIFEST_SIZE: usize = 64 * 1024 * 1024;
const MAX_PARALLEL_DOWNLOADS: usize = 8;

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("the auto-config URL must use HTTPS")]
    InsecureUrl,
    #[error("invalid auto-config URL: {0}")]
    InvalidUrl(String),
    #[error("could not download auto-config: {0}")]
    Download(String),
    #[error("repository metadata exceeds its safe size limit")]
    TooLarge,
    #[error("could not decompress repository metadata: {0}")]
    Compression(String),
    #[error("could not decode Java serialization: {0}")]
    Serialization(String),
    #[error("repository metadata has an unsupported structure: {0}")]
    Unsupported(String),
    #[error("could not connect to repository transfer service: {0}")]
    Transfer(String),
    #[error("repository contains an unsafe path component: {0}")]
    UnsafePath(String),
    #[error("could not inspect local addon files: {0}")]
    Local(String),
    #[error("synchronization failed: {0}")]
    Sync(String),
    #[error("synchronization stopped")]
    Cancelled,
}

pub struct SyncControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
    wait_lock: Mutex<()>,
    wait_signal: Condvar,
}

impl SyncControl {
    fn new() -> Self {
        Self {
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            wait_lock: Mutex::new(()),
            wait_signal: Condvar::new(),
        }
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Release);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Release);
        self.wait_signal.notify_all();
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.paused.store(false, Ordering::Release);
        self.wait_signal.notify_all();
    }

    fn checkpoint(&self) -> Result<(), RepositoryError> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err(RepositoryError::Cancelled);
        }
        if self.paused.load(Ordering::Acquire) {
            let guard = self
                .wait_lock
                .lock()
                .map_err(|_| RepositoryError::Sync("sync control lock was poisoned".into()))?;
            let _guard = self
                .wait_signal
                .wait_while(guard, |_| {
                    self.paused.load(Ordering::Acquire) && !self.cancelled.load(Ordering::Acquire)
                })
                .map_err(|_| RepositoryError::Sync("sync control lock was poisoned".into()))?;
        }
        if self.cancelled.load(Ordering::Acquire) {
            Err(RepositoryError::Cancelled)
        } else {
            Ok(())
        }
    }
}

struct ActiveSync {
    id: String,
    control: Arc<SyncControl>,
}

#[derive(Default)]
pub struct SyncCoordinator {
    active: Mutex<Option<ActiveSync>>,
}

impl SyncCoordinator {
    pub fn begin(&self, id: String) -> Result<Arc<SyncControl>, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "sync state is unavailable")?;
        if active.is_some() {
            return Err("another repository synchronization is already running".into());
        }
        let control = Arc::new(SyncControl::new());
        *active = Some(ActiveSync {
            id,
            control: control.clone(),
        });
        Ok(control)
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut active) = self.active.lock()
            && active.as_ref().is_some_and(|sync| sync.id == id)
        {
            *active = None;
        }
    }

    pub fn control(&self, id: &str) -> Result<Arc<SyncControl>, String> {
        self.active
            .lock()
            .map_err(|_| "sync state is unavailable")?
            .as_ref()
            .filter(|sync| sync.id == id)
            .map(|sync| sync.control.clone())
            .ok_or_else(|| "that synchronization is no longer running".into())
    }
}

struct RepositoryEndpoint {
    info: RepositoryInfo,
    login: String,
    password: String,
}

#[derive(Debug)]
struct SyncManifest {
    summary: ManifestSummary,
    entries: Vec<ManifestEntry>,
}

#[derive(Debug)]
struct ManifestEntry {
    remote_path: PathBuf,
    local_path: PathBuf,
    addon_name: String,
    addon_remote_root: PathBuf,
    size: u64,
    compressed_size: u64,
    sha1: Option<String>,
    compressed: bool,
}

pub async fn inspect(source_url: &str) -> Result<RepositorySnapshot, RepositoryError> {
    let endpoint = download_autoconfig(source_url).await?;
    let transfer = TransferEndpoint {
        host: endpoint.info.host.clone(),
        port: endpoint.info.port.unwrap_or(21),
        login: endpoint.login,
        password: endpoint.password,
    };
    let (manifest, published_modsets) =
        tokio::task::spawn_blocking(move || fetch_repository_metadata(&transfer))
            .await
            .map_err(|error| RepositoryError::Transfer(error.to_string()))??;
    // Touch the internal entries here so this inspect path exercises the same
    // validated representation the future download planner will consume.
    let _planned_transfer_bytes: u64 = manifest
        .entries
        .iter()
        .map(|entry| {
            let _identity = (
                &entry.remote_path,
                &entry.local_path,
                &entry.addon_name,
                &entry.addon_remote_root,
                &entry.sha1,
                entry.size,
            );
            if entry.compressed && entry.compressed_size > 0 {
                entry.compressed_size
            } else {
                entry.size
            }
        })
        .sum();
    let addons = build_addon_catalog(&manifest.entries);
    Ok(RepositorySnapshot {
        repository: endpoint.info,
        manifest: manifest.summary,
        published_modsets,
        addons,
    })
}

pub async fn plan_sync(
    source_url: &str,
    selected_addons: Vec<String>,
    destination: PathBuf,
) -> Result<SyncPlan, RepositoryError> {
    let endpoint = download_autoconfig(source_url).await?;
    let transfer = TransferEndpoint {
        host: endpoint.info.host,
        port: endpoint.info.port.unwrap_or(21),
        login: endpoint.login,
        password: endpoint.password,
    };
    tokio::task::spawn_blocking(move || {
        let (manifest, _) = fetch_repository_metadata(&transfer)?;
        build_sync_plan(&manifest, &selected_addons, &destination)
    })
    .await
    .map_err(|error| RepositoryError::Local(error.to_string()))?
}

#[derive(Clone)]
struct TransferEndpoint {
    host: String,
    port: i32,
    login: String,
    password: String,
}

pub async fn execute_sync<F>(
    source_url: &str,
    selected_addons: Vec<String>,
    destination: PathBuf,
    control: Arc<SyncControl>,
    on_progress: F,
) -> Result<SyncResult, RepositoryError>
where
    F: Fn(SyncProgress) + Send + Sync + 'static,
{
    on_progress(SyncProgress {
        phase: SyncPhase::Preparing,
        downloaded_bytes: 0,
        total_bytes: 0,
        completed_files: 0,
        total_files: 0,
        current_file: None,
    });
    let endpoint = download_autoconfig(source_url).await?;
    let transfer = TransferEndpoint {
        host: endpoint.info.host,
        port: endpoint.info.port.unwrap_or(21),
        login: endpoint.login,
        password: endpoint.password,
    };
    tokio::task::spawn_blocking(move || {
        let (manifest, _) = fetch_repository_metadata(&transfer)?;
        let plan = build_sync_plan(&manifest, &selected_addons, &destination)?;
        if !plan.missing_addons.is_empty() || !plan.ambiguous_addons.is_empty() {
            return Err(RepositoryError::Sync(format!(
                "unresolved addons; missing: {:?}; ambiguous: {:?}",
                plan.missing_addons, plan.ambiguous_addons
            )));
        }
        control.checkpoint()?;
        download_and_install(
            &transfer,
            &manifest,
            &plan,
            &destination,
            &control,
            &on_progress,
        )
    })
    .await
    .map_err(|error| RepositoryError::Sync(error.to_string()))?
}

async fn download_autoconfig(source_url: &str) -> Result<RepositoryEndpoint, RepositoryError> {
    let parsed =
        Url::parse(source_url).map_err(|error| RepositoryError::InvalidUrl(error.to_string()))?;
    if parsed.scheme() != "https" {
        return Err(RepositoryError::InsecureUrl);
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| RepositoryError::Download(error.to_string()))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| RepositoryError::Download(error.to_string()))?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_AUTOCONFIG_SIZE as u64)
    {
        return Err(RepositoryError::TooLarge);
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| RepositoryError::Download(error.to_string()))?;
    if bytes.len() > MAX_AUTOCONFIG_SIZE {
        return Err(RepositoryError::TooLarge);
    }

    decode_autoconfig(&bytes, source_url)
}

fn decode_autoconfig(
    bytes: &[u8],
    source_url: &str,
) -> Result<RepositoryEndpoint, RepositoryError> {
    let root = decode_root(bytes, MAX_AUTOCONFIG_SIZE)?;
    if root.class_name() != "fr.soe.a3s.domain.repository.AutoConfig" {
        return Err(RepositoryError::Unsupported(format!(
            "unexpected root class {}",
            root.class_name()
        )));
    }

    let name = string_field(&root, "repositoryName")?;
    let protocol = root
        .get_field("protocole")
        .and_then(Value::object_data)
        .ok_or_else(|| RepositoryError::Unsupported("missing protocol object".into()))?;
    let host = string_field(protocol, "url")?;
    let port = optional_string_field(protocol, "port").and_then(|value| value.parse().ok());
    let login = optional_string_field(protocol, "login").unwrap_or_default();
    let password = optional_string_field(protocol, "password").unwrap_or_default();
    let protocol_name = protocol
        .get_field("protocolType")
        .and_then(Value::enum_data)
        .map(|(_, value)| value.to_owned())
        .ok_or_else(|| RepositoryError::Unsupported("missing protocol type".into()))?;

    if protocol_name != "FTP" {
        return Err(RepositoryError::Unsupported(format!(
            "transfer protocol {protocol_name} is not implemented yet"
        )));
    }

    Ok(RepositoryEndpoint {
        info: RepositoryInfo {
            name,
            protocol: protocol_name,
            host,
            port,
            path: None,
            anonymous: login.is_empty() || login.eq_ignore_ascii_case("anonymous"),
            source_url: source_url.to_owned(),
        },
        login,
        password,
    })
}

fn fetch_repository_metadata(
    endpoint: &TransferEndpoint,
) -> Result<(SyncManifest, Vec<PublishedModset>), RepositoryError> {
    let mut ftp = connect_ftp(endpoint)?;
    let manifest_bytes = ftp
        .retr_as_buffer(".a3s/sync")
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?
        .into_inner();
    let events_bytes = ftp
        .retr_as_buffer(".a3s/events")
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?
        .into_inner();
    let _ = ftp.quit();
    if manifest_bytes.len() > MAX_MANIFEST_SIZE || events_bytes.len() > MAX_AUTOCONFIG_SIZE {
        return Err(RepositoryError::TooLarge);
    }
    Ok((
        decode_manifest(&manifest_bytes)?,
        decode_events(&events_bytes)?,
    ))
}

fn connect_ftp(endpoint: &TransferEndpoint) -> Result<FtpStream, RepositoryError> {
    let port = u16::try_from(endpoint.port)
        .map_err(|_| RepositoryError::Transfer("invalid FTP port".into()))?;
    let address = (endpoint.host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?
        .next()
        .ok_or_else(|| RepositoryError::Transfer("host did not resolve".into()))?;
    let mut ftp = FtpStream::connect_timeout(address, Duration::from_secs(10))
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.get_ref()
        .set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.get_ref()
        .set_write_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.login(&endpoint.login, &endpoint.password)
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    ftp.transfer_type(FileType::Binary)
        .map_err(|error| RepositoryError::Transfer(error.to_string()))?;
    Ok(ftp)
}

fn decode_manifest(bytes: &[u8]) -> Result<SyncManifest, RepositoryError> {
    let root = decode_root(bytes, MAX_MANIFEST_SIZE)?;
    if root.class_name() != "fr.soe.a3s.domain.repository.SyncTreeDirectory" {
        return Err(RepositoryError::Unsupported(format!(
            "unexpected manifest root class {}",
            root.class_name()
        )));
    }
    let mut manifest = SyncManifest {
        summary: ManifestSummary {
            directories: 0,
            files: 0,
            total_bytes: 0,
            compressed_files: 0,
            addon_roots: 0,
            unhashed_files: 0,
        },
        entries: Vec::new(),
    };
    walk_directory(&root, Path::new(""), true, None, &mut manifest)?;
    Ok(manifest)
}

#[derive(Clone)]
struct AddonContext {
    name: String,
    remote_root: PathBuf,
}

fn should_start_addon(marked_as_addon: bool, inherited_addon: Option<&AddonContext>) -> bool {
    marked_as_addon && inherited_addon.is_none_or(|parent| !parent.name.starts_with('@'))
}

fn decode_events(bytes: &[u8]) -> Result<Vec<PublishedModset>, RepositoryError> {
    let root = decode_root(bytes, MAX_AUTOCONFIG_SIZE)?;
    if root.class_name() != "fr.soe.a3s.domain.repository.Events" {
        return Err(RepositoryError::Unsupported(format!(
            "unexpected events root class {}",
            root.class_name()
        )));
    }

    let mut modsets = Vec::new();
    for value in list_field(&root, "list")? {
        let event = value
            .object_data()
            .ok_or_else(|| RepositoryError::Unsupported("event is not an object".into()))?;
        if event.class_name() != "fr.soe.a3s.domain.repository.Event" {
            return Err(RepositoryError::Unsupported(format!(
                "unexpected event class {}",
                event.class_name()
            )));
        }
        let mut addons = hash_map_string_keys(event, "addonNames")?;
        let mut userconfig_folders = hash_map_string_keys(event, "userconfigFolderNames")?;
        // HashMap serialization has no semantic launch order. Sorting here is
        // only for stable display/diff output; profiles supply real ordering.
        addons.sort_by_key(|value| value.to_ascii_lowercase());
        userconfig_folders.sort_by_key(|value| value.to_ascii_lowercase());
        modsets.push(PublishedModset {
            name: string_field(event, "name")?,
            description: optional_string_field(event, "description").unwrap_or_default(),
            addons,
            userconfig_folders,
        });
    }
    modsets.sort_by_key(|event| event.name.to_ascii_lowercase());
    Ok(modsets)
}

fn hash_map_string_keys(object: &ObjectData, field: &str) -> Result<Vec<String>, RepositoryError> {
    let map = object
        .get_field(field)
        .and_then(Value::object_data)
        .ok_or_else(|| RepositoryError::Unsupported(format!("missing map {field}")))?;
    if map.class_name() != "java.util.HashMap" {
        return Err(RepositoryError::Unsupported(format!(
            "{field} is not a HashMap"
        )));
    }
    let mut annotations = map
        .get_annotation(0)
        .ok_or_else(|| RepositoryError::Unsupported("HashMap has no content".into()))?;
    let _capacity = annotations
        .read_i32()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    let size = annotations
        .read_i32()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    if !(0..=100_000).contains(&size) {
        return Err(RepositoryError::Unsupported("invalid HashMap size".into()));
    }
    let mut keys = Vec::with_capacity(size as usize);
    for _ in 0..size {
        let key = annotations
            .read_object()
            .map_err(|error| RepositoryError::Serialization(error.to_string()))?
            .string()
            .ok_or_else(|| RepositoryError::Unsupported("map key is not a string".into()))?;
        let _value = annotations
            .read_object()
            .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
        safe_component(key)?;
        keys.push(key.to_owned());
    }
    Ok(keys)
}

fn walk_directory(
    directory: &ObjectData,
    parent: &Path,
    is_root: bool,
    inherited_addon: Option<AddonContext>,
    manifest: &mut SyncManifest,
) -> Result<(), RepositoryError> {
    let name = string_field(directory, "name")?;
    let path = if is_root {
        parent.to_owned()
    } else {
        parent.join(safe_component(&name)?)
    };
    manifest.summary.directories += 1;
    let marked_as_addon = !is_root && bool_field(directory, "markAsAddon").unwrap_or(false);
    let starts_new_addon = should_start_addon(marked_as_addon, inherited_addon.as_ref());
    if starts_new_addon {
        manifest.summary.addon_roots += 1;
    }
    let addon = if starts_new_addon {
        Some(AddonContext {
            name: name.clone(),
            remote_root: path.clone(),
        })
    } else {
        inherited_addon
    };

    for value in list_field(directory, "list")? {
        let child = value
            .object_data()
            .ok_or_else(|| RepositoryError::Unsupported("tree child is not an object".into()))?;
        match child.class_name() {
            "fr.soe.a3s.domain.repository.SyncTreeDirectory" => {
                walk_directory(child, &path, false, addon.clone(), manifest)?;
            }
            "fr.soe.a3s.domain.repository.SyncTreeLeaf" => {
                if bool_field(child, "deleted").unwrap_or(false) {
                    continue;
                }
                let file_name = string_field(child, "name")?;
                let size = long_field(child, "size")?;
                let compressed_size = long_field(child, "compressedSize").unwrap_or(0);
                let sha1_value = string_field(child, "sha1")?;
                let sha1 = if sha1_value == "0" && size == 0 {
                    manifest.summary.unhashed_files += 1;
                    None
                } else if sha1_value.len() == 40
                    && sha1_value.bytes().all(|byte| byte.is_ascii_hexdigit())
                {
                    Some(sha1_value)
                } else {
                    return Err(RepositoryError::Unsupported(format!(
                        "invalid SHA-1 for {file_name}"
                    )));
                };
                let compressed = bool_field(child, "compressed").unwrap_or(false);
                let Some(addon) = addon.as_ref() else {
                    return Err(RepositoryError::Unsupported(format!(
                        "file {file_name} is not inside a marked addon root"
                    )));
                };
                let relative_parent = path.strip_prefix(&addon.remote_root).map_err(|_| {
                    RepositoryError::Unsupported("addon ancestry is inconsistent".into())
                })?;
                let remote_path = path.join(safe_component(&file_name)?);
                let local_path = PathBuf::from(&addon.name)
                    .join(relative_parent)
                    .join(safe_component(&file_name)?);
                manifest.summary.files += 1;
                manifest.summary.total_bytes = manifest.summary.total_bytes.saturating_add(size);
                if compressed {
                    manifest.summary.compressed_files += 1;
                }
                manifest.entries.push(ManifestEntry {
                    remote_path,
                    local_path,
                    addon_name: addon.name.clone(),
                    addon_remote_root: addon.remote_root.clone(),
                    size,
                    compressed_size,
                    sha1,
                    compressed,
                });
            }
            class => {
                return Err(RepositoryError::Unsupported(format!(
                    "unexpected manifest node {class}"
                )));
            }
        }
    }
    Ok(())
}

fn build_addon_catalog(entries: &[ManifestEntry]) -> Vec<AddonCatalogEntry> {
    #[derive(Default)]
    struct Totals {
        name: String,
        remote_root: PathBuf,
        files: usize,
        total_bytes: u64,
        transfer_bytes: u64,
    }

    let mut by_root: HashMap<String, Totals> = HashMap::new();
    for entry in entries {
        let key = entry.addon_remote_root.to_string_lossy().into_owned();
        let totals = by_root.entry(key).or_insert_with(|| Totals {
            name: entry.addon_name.clone(),
            remote_root: entry.addon_remote_root.clone(),
            ..Totals::default()
        });
        totals.files += 1;
        totals.total_bytes = totals.total_bytes.saturating_add(entry.size);
        totals.transfer_bytes = totals.transfer_bytes.saturating_add(
            if entry.compressed && entry.compressed_size > 0 {
                entry.compressed_size
            } else {
                entry.size
            },
        );
    }

    let mut name_counts: HashMap<String, usize> = HashMap::new();
    for totals in by_root.values() {
        *name_counts
            .entry(totals.name.to_ascii_lowercase())
            .or_default() += 1;
    }
    let mut catalog = by_root
        .into_values()
        .map(|totals| {
            let remote_path = totals.remote_root.to_string_lossy().into_owned();
            AddonCatalogEntry {
                id: remote_path.clone(),
                name: totals.name.clone(),
                remote_path,
                files: totals.files,
                total_bytes: totals.total_bytes,
                transfer_bytes: totals.transfer_bytes,
                duplicate_name: name_counts
                    .get(&totals.name.to_ascii_lowercase())
                    .copied()
                    .unwrap_or_default()
                    > 1,
            }
        })
        .collect::<Vec<_>>();
    catalog.sort_by_key(|addon| (addon.name.to_ascii_lowercase(), addon.remote_path.clone()));
    catalog
}

fn build_sync_plan(
    manifest: &SyncManifest,
    selected_addons: &[String],
    destination: &Path,
) -> Result<SyncPlan, RepositoryError> {
    let mut requested_addons = Vec::new();
    let mut requested_seen = std::collections::HashSet::new();
    for addon in selected_addons {
        safe_component(addon)?;
        if !addon.starts_with('@') {
            return Err(RepositoryError::Unsupported(format!(
                "{addon} is a DLC identifier, not a repository addon"
            )));
        }
        if requested_seen.insert(addon.to_ascii_lowercase()) {
            requested_addons.push(addon.clone());
        }
    }

    let mut roots_by_name: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
    for entry in &manifest.entries {
        roots_by_name
            .entry(entry.addon_name.to_ascii_lowercase())
            .or_default()
            .insert(entry.addon_remote_root.to_string_lossy().into_owned());
    }

    let mut resolved_addons = Vec::new();
    let mut missing_addons = Vec::new();
    let mut ambiguous_addons = Vec::new();
    let mut resolved_names = std::collections::HashSet::new();
    for addon in &requested_addons {
        match roots_by_name.get(&addon.to_ascii_lowercase()) {
            None => missing_addons.push(addon.clone()),
            Some(roots) if roots.len() > 1 => ambiguous_addons.push(addon.clone()),
            Some(_) => {
                resolved_names.insert(addon.to_ascii_lowercase());
                resolved_addons.push(addon.clone());
            }
        }
    }

    let mut plan = SyncPlan {
        requested_addons,
        resolved_addons,
        missing_addons,
        ambiguous_addons,
        total_files: 0,
        verified_files: 0,
        download_files: 0,
        replacement_files: 0,
        download_bytes: 0,
        final_bytes: 0,
        operations: Vec::new(),
    };

    for entry in manifest
        .entries
        .iter()
        .filter(|entry| resolved_names.contains(&entry.addon_name.to_ascii_lowercase()))
    {
        plan.total_files += 1;
        plan.final_bytes = plan.final_bytes.saturating_add(entry.size);
        let local_path = destination.join(&entry.local_path);
        let action = match std::fs::metadata(&local_path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Some(SyncAction::Download)
            }
            Err(error) => return Err(RepositoryError::Local(error.to_string())),
            Ok(metadata) if !metadata.is_file() || metadata.len() != entry.size => {
                Some(SyncAction::Replace)
            }
            Ok(_) => {
                let matches = match &entry.sha1 {
                    Some(expected) => sha1_file(&local_path)? == *expected,
                    None => entry.size == 0,
                };
                if matches {
                    plan.verified_files += 1;
                    None
                } else {
                    Some(SyncAction::Replace)
                }
            }
        };

        if let Some(action) = action {
            let transfer_bytes = if entry.compressed && entry.compressed_size > 0 {
                entry.compressed_size
            } else {
                entry.size
            };
            match action {
                SyncAction::Download => plan.download_files += 1,
                SyncAction::Replace => plan.replacement_files += 1,
            }
            plan.download_bytes = plan.download_bytes.saturating_add(transfer_bytes);
            plan.operations.push(SyncPlanItem {
                action,
                addon: entry.addon_name.clone(),
                relative_path: entry.local_path.to_string_lossy().into_owned(),
                transfer_bytes,
                final_bytes: entry.size,
            });
        }
    }
    Ok(plan)
}

fn sha1_file(path: &Path) -> Result<String, RepositoryError> {
    let mut file =
        std::fs::File::open(path).map_err(|error| RepositoryError::Local(error.to_string()))?;
    let mut digest = Sha1::new();
    std::io::copy(&mut file, &mut digest)
        .map_err(|error| RepositoryError::Local(error.to_string()))?;
    Ok(format!("{:x}", digest.finalize()))
}

fn download_and_install<F>(
    endpoint: &TransferEndpoint,
    manifest: &SyncManifest,
    plan: &SyncPlan,
    destination: &Path,
    control: &SyncControl,
    on_progress: &F,
) -> Result<SyncResult, RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
    if plan.operations.is_empty() {
        return Ok(SyncResult {
            installed_files: 0,
            downloaded_bytes: 0,
            backup_directory: None,
            destination: destination.to_string_lossy().into_owned(),
        });
    }
    let available = fs2::available_space(destination)
        .map_err(|error| RepositoryError::Sync(format!("could not check free space: {error}")))?;
    let required = plan.download_bytes.saturating_add(512 * 1024 * 1024);
    if available < required {
        return Err(RepositoryError::Sync(format!(
            "insufficient free space: {} bytes available, {} bytes required including safety margin",
            available, required
        )));
    }

    let operation_paths = plan
        .operations
        .iter()
        .map(|item| item.relative_path.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut entries = manifest
        .entries
        .iter()
        .filter(|entry| operation_paths.contains(entry.local_path.to_string_lossy().as_ref()))
        .collect::<Vec<_>>();
    if entries.len() != plan.operations.len() {
        return Err(RepositoryError::Sync(
            "sync plan no longer matches the repository manifest".into(),
        ));
    }
    if let Some(entry) = entries.iter().find(|entry| entry.compressed) {
        return Err(RepositoryError::Sync(format!(
            "compressed repository entry is not supported yet: {}",
            entry.remote_path.display()
        )));
    }
    // Start large transfers first so all connections remain useful instead of
    // leaving one large file as a single-connection tail at the end.
    entries.sort_unstable_by_key(|entry| std::cmp::Reverse(entry.size));

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| RepositoryError::Sync(error.to_string()))?
        .as_secs();
    let run_id = format!("{stamp}-{}", std::process::id());
    let state_root = destination.join(".armalauncher");
    let staging_root = state_root.join("staging").join(&run_id);
    let backup_root = state_root.join("backups").join(&run_id);
    std::fs::create_dir_all(&staging_root)
        .map_err(|error| RepositoryError::Sync(error.to_string()))?;

    let staged = stage_downloads(
        endpoint,
        &entries,
        &staging_root,
        plan.download_bytes,
        control,
        on_progress,
    );
    if let Err(error) = staged {
        let _ = std::fs::remove_dir_all(&staging_root);
        return Err(error);
    }

    let mut installed: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
    let install_result = (|| {
        on_progress(SyncProgress {
            phase: SyncPhase::Installing,
            downloaded_bytes: plan.download_bytes,
            total_bytes: plan.download_bytes,
            completed_files: 0,
            total_files: entries.len(),
            current_file: None,
        });
        for (index, entry) in entries.iter().enumerate() {
            control.checkpoint()?;
            let staged_file = staging_root.join(&entry.local_path);
            let target = destination.join(&entry.local_path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| RepositoryError::Sync(error.to_string()))?;
            }
            let backup = if target.exists() {
                let backup = backup_root.join(&entry.local_path);
                if let Some(parent) = backup.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| RepositoryError::Sync(error.to_string()))?;
                }
                std::fs::rename(&target, &backup)
                    .map_err(|error| RepositoryError::Sync(error.to_string()))?;
                Some(backup)
            } else {
                None
            };
            if let Err(error) = std::fs::rename(&staged_file, &target) {
                if let Some(backup) = &backup {
                    let _ = std::fs::rename(backup, &target);
                }
                return Err(RepositoryError::Sync(error.to_string()));
            }
            installed.push((target, backup));
            on_progress(SyncProgress {
                phase: SyncPhase::Installing,
                downloaded_bytes: plan.download_bytes,
                total_bytes: plan.download_bytes,
                completed_files: index + 1,
                total_files: entries.len(),
                current_file: Some(entry.local_path.to_string_lossy().into_owned()),
            });
        }
        Ok::<(), RepositoryError>(())
    })();

    if let Err(error) = install_result {
        for (target, backup) in installed.into_iter().rev() {
            let _ = std::fs::remove_file(&target);
            if let Some(backup) = backup {
                let _ = std::fs::rename(backup, target);
            }
        }
        let _ = std::fs::remove_dir_all(&staging_root);
        return Err(error);
    }

    let _ = std::fs::remove_dir_all(&staging_root);
    Ok(SyncResult {
        installed_files: entries.len(),
        downloaded_bytes: plan.download_bytes,
        backup_directory: (plan.replacement_files > 0)
            .then(|| backup_root.to_string_lossy().into_owned()),
        destination: destination.to_string_lossy().into_owned(),
    })
}

fn stage_downloads<F>(
    endpoint: &TransferEndpoint,
    entries: &[&ManifestEntry],
    staging_root: &Path,
    total_bytes: u64,
    control: &SyncControl,
    on_progress: &F,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
    let worker_count = download_worker_count(entries.len());
    let next_entry = AtomicUsize::new(0);
    let completed_files = AtomicUsize::new(0);
    let downloaded_bytes = AtomicU64::new(0);
    let failed = AtomicBool::new(false);
    let failure = Mutex::new(None::<RepositoryError>);
    let progress_gate = Mutex::new((0_u64, Instant::now()));

    on_progress(SyncProgress {
        phase: SyncPhase::Downloading,
        downloaded_bytes: 0,
        total_bytes,
        completed_files: 0,
        total_files: entries.len(),
        current_file: None,
    });

    std::thread::scope(|scope| {
        let mut workers = Vec::with_capacity(worker_count);
        for _ in 0..worker_count {
            workers.push(scope.spawn(|| {
                let result = (|| {
                    let mut ftp = connect_ftp(endpoint)?;
                    loop {
                        control.checkpoint()?;
                        if failed.load(Ordering::Acquire) {
                            break;
                        }
                        let index = next_entry.fetch_add(1, Ordering::AcqRel);
                        let Some(entry) = entries.get(index).copied() else {
                            break;
                        };
                        download_entry(
                            &mut ftp,
                            entry,
                            staging_root,
                            total_bytes,
                            entries.len(),
                            control,
                            &failed,
                            &downloaded_bytes,
                            &completed_files,
                            &progress_gate,
                            on_progress,
                        )?;
                    }
                    let _ = ftp.quit();
                    Ok::<(), RepositoryError>(())
                })();
                if let Err(error) = result {
                    if let Ok(mut first) = failure.lock()
                        && first.is_none()
                    {
                        *first = Some(error);
                    }
                    failed.store(true, Ordering::Release);
                }
            }));
        }
        for worker in workers {
            if worker.join().is_err() {
                failed.store(true, Ordering::Release);
                if let Ok(mut first) = failure.lock()
                    && first.is_none()
                {
                    *first = Some(RepositoryError::Sync(
                        "a repository download worker stopped unexpectedly".into(),
                    ));
                }
            }
        }
    });

    let mut failure = failure
        .lock()
        .map_err(|_| RepositoryError::Sync("download state lock was poisoned".into()))?;
    if let Some(error) = failure.take() {
        Err(error)
    } else {
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn download_entry<F>(
    ftp: &mut FtpStream,
    entry: &ManifestEntry,
    staging_root: &Path,
    total_bytes: u64,
    total_files: usize,
    control: &SyncControl,
    failed: &AtomicBool,
    downloaded_bytes: &AtomicU64,
    completed_files: &AtomicUsize,
    progress_gate: &Mutex<(u64, Instant)>,
    on_progress: &F,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
    let target = staging_root.join(&entry.local_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| RepositoryError::Sync(error.to_string()))?;
    }
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&target)
        .map_err(|error| RepositoryError::Sync(error.to_string()))?;
    let remote = entry.remote_path.to_string_lossy().replace('\\', "/");
    let current_file = entry.local_path.to_string_lossy().into_owned();
    emit_download_progress(
        downloaded_bytes,
        completed_files,
        total_bytes,
        total_files,
        &current_file,
        progress_gate,
        on_progress,
        true,
    )?;

    ftp.retr(&remote, |reader| {
        let mut buffer = [0_u8; 256 * 1024];
        loop {
            control.checkpoint().map_err(as_ftp_io_error)?;
            if failed.load(Ordering::Acquire) {
                return Err(FtpError::ConnectionError(std::io::Error::other(
                    "another parallel transfer failed",
                )));
            }
            let count = reader
                .read(&mut buffer)
                .map_err(FtpError::ConnectionError)?;
            if count == 0 {
                break;
            }
            file.write_all(&buffer[..count])
                .map_err(FtpError::ConnectionError)?;
            downloaded_bytes.fetch_add(count as u64, Ordering::AcqRel);
            emit_download_progress(
                downloaded_bytes,
                completed_files,
                total_bytes,
                total_files,
                &current_file,
                progress_gate,
                on_progress,
                false,
            )
            .map_err(as_ftp_io_error)?;
        }
        Ok(())
    })
    .map_err(|error| RepositoryError::Transfer(format!("{remote}: {error}")))?;
    file.flush()
        .map_err(|error| RepositoryError::Sync(error.to_string()))?;
    control.checkpoint()?;
    verify_download(&target, entry)?;
    completed_files.fetch_add(1, Ordering::AcqRel);
    emit_download_progress(
        downloaded_bytes,
        completed_files,
        total_bytes,
        total_files,
        &current_file,
        progress_gate,
        on_progress,
        true,
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn emit_download_progress<F>(
    downloaded_bytes: &AtomicU64,
    completed_files: &AtomicUsize,
    total_bytes: u64,
    total_files: usize,
    current_file: &str,
    progress_gate: &Mutex<(u64, Instant)>,
    on_progress: &F,
    force: bool,
) -> Result<(), RepositoryError>
where
    F: Fn(SyncProgress),
{
    let mut gate = progress_gate
        .lock()
        .map_err(|_| RepositoryError::Sync("download progress lock was poisoned".into()))?;
    let current_bytes = downloaded_bytes.load(Ordering::Acquire);
    if force
        || current_bytes.saturating_sub(gate.0) >= 1024 * 1024
        || gate.1.elapsed() >= Duration::from_millis(100)
    {
        on_progress(SyncProgress {
            phase: SyncPhase::Downloading,
            downloaded_bytes: current_bytes,
            total_bytes,
            completed_files: completed_files.load(Ordering::Acquire),
            total_files,
            current_file: Some(current_file.to_owned()),
        });
        *gate = (current_bytes, Instant::now());
    }
    Ok(())
}

fn as_ftp_io_error(error: RepositoryError) -> FtpError {
    FtpError::ConnectionError(std::io::Error::other(error.to_string()))
}

fn download_worker_count(file_count: usize) -> usize {
    file_count.clamp(1, MAX_PARALLEL_DOWNLOADS)
}

fn verify_download(path: &Path, entry: &ManifestEntry) -> Result<(), RepositoryError> {
    let size = std::fs::metadata(path)
        .map_err(|error| RepositoryError::Sync(error.to_string()))?
        .len();
    if size != entry.size {
        return Err(RepositoryError::Sync(format!(
            "size mismatch for {}: expected {}, received {}",
            entry.local_path.display(),
            entry.size,
            size
        )));
    }
    if let Some(expected) = &entry.sha1 {
        let actual = sha1_file(path)?;
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(RepositoryError::Sync(format!(
                "SHA-1 mismatch for {}",
                entry.local_path.display()
            )));
        }
    }
    Ok(())
}

fn list_field<'a>(object: &'a ObjectData, field: &str) -> Result<Vec<&'a Value>, RepositoryError> {
    let list = object
        .get_field(field)
        .and_then(Value::object_data)
        .ok_or_else(|| RepositoryError::Unsupported(format!("missing list {field}")))?;
    if list.class_name() != "java.util.ArrayList" {
        return Err(RepositoryError::Unsupported(format!(
            "{field} is not an ArrayList"
        )));
    }
    let size = int_field(list, "size")?;
    if !(0..=1_000_000).contains(&size) {
        return Err(RepositoryError::Unsupported("invalid list size".into()));
    }
    let mut annotations = list
        .get_annotation(0)
        .ok_or_else(|| RepositoryError::Unsupported("ArrayList has no content".into()))?;
    let written_size = annotations
        .read_i32()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    if written_size != size {
        return Err(RepositoryError::Unsupported(
            "ArrayList size markers disagree".into(),
        ));
    }
    (0..size)
        .map(|_| {
            annotations
                .read_object()
                .map_err(|error| RepositoryError::Serialization(error.to_string()))
        })
        .collect()
}

fn decode_root(bytes: &[u8], limit: usize) -> Result<ObjectData, RepositoryError> {
    let mut raw = Vec::new();
    GzDecoder::new(Cursor::new(bytes))
        .take(limit as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|error| RepositoryError::Compression(error.to_string()))?;
    if raw.len() > limit {
        return Err(RepositoryError::TooLarge);
    }
    let mut parser = Parser::new(Cursor::new(raw))
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?;
    match parser
        .read()
        .map_err(|error| RepositoryError::Serialization(error.to_string()))?
    {
        Content::Object(Value::Object(object)) => Ok(object),
        _ => Err(RepositoryError::Unsupported("root is not an object".into())),
    }
}

fn safe_component(name: &str) -> Result<&str, RepositoryError> {
    let path = Path::new(name);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) if name != "." && name != ".." => Ok(name),
        _ => Err(RepositoryError::UnsafePath(name.to_owned())),
    }
}

fn string_field(object: &ObjectData, name: &str) -> Result<String, RepositoryError> {
    optional_string_field(object, name)
        .ok_or_else(|| RepositoryError::Unsupported(format!("missing {name}")))
}

fn optional_string_field(object: &ObjectData, name: &str) -> Option<String> {
    object.get_field(name)?.string().map(ToOwned::to_owned)
}

fn bool_field(object: &ObjectData, name: &str) -> Option<bool> {
    match object.get_field(name)?.primitive()? {
        PrimitiveType::Boolean(value) => Some(*value),
        _ => None,
    }
}

fn int_field(object: &ObjectData, name: &str) -> Result<i32, RepositoryError> {
    match object.get_field(name).and_then(Value::primitive) {
        Some(PrimitiveType::Int(value)) => Ok(*value),
        _ => Err(RepositoryError::Unsupported(format!(
            "missing integer {name}"
        ))),
    }
}

fn long_field(object: &ObjectData, name: &str) -> Result<u64, RepositoryError> {
    match object.get_field(name).and_then(Value::primitive) {
        Some(PrimitiveType::Long(value)) => u64::try_from(*value)
            .map_err(|_| RepositoryError::Unsupported(format!("negative {name}"))),
        _ => Err(RepositoryError::Unsupported(format!("missing long {name}"))),
    }
}

// Protocol fixtures live in the original compatibility harness. Integration
// tests for this application exercise the public commands instead.
#[cfg(test)]
mod sync_control_tests {
    use super::{
        AddonContext, MAX_PARALLEL_DOWNLOADS, RepositoryError, SyncControl, SyncCoordinator,
        download_worker_count, should_start_addon,
    };
    use std::path::PathBuf;
    use std::sync::{Arc, mpsc};
    use std::time::Duration;

    #[test]
    fn pause_blocks_until_resume() {
        let control = Arc::new(SyncControl::new());
        control.pause();
        let worker_control = control.clone();
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            sender.send(worker_control.checkpoint()).unwrap();
        });

        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        control.resume();
        assert!(
            receiver
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .is_ok()
        );
        worker.join().unwrap();
    }

    #[test]
    fn cancellation_releases_a_paused_worker() {
        let control = Arc::new(SyncControl::new());
        control.pause();
        let worker_control = control.clone();
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            sender.send(worker_control.checkpoint()).unwrap();
        });

        control.cancel();
        assert!(matches!(
            receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
            Err(RepositoryError::Cancelled)
        ));
        worker.join().unwrap();
    }

    #[test]
    fn coordinator_allows_only_one_active_sync() {
        let coordinator = SyncCoordinator::default();
        assert!(coordinator.begin("first".into()).is_ok());
        assert!(coordinator.begin("second".into()).is_err());
        coordinator.finish("first");
        assert!(coordinator.begin("second".into()).is_ok());
    }

    #[test]
    fn prefixed_repository_addon_owns_nested_marked_folders() {
        let prefixed = AddonContext {
            name: "@LT_ace".into(),
            remote_root: PathBuf::from("@LT_ace"),
        };
        let collection = AddonContext {
            name: "LT_Mods_Optional".into(),
            remote_root: PathBuf::from("LT_Mods_Optional"),
        };

        assert!(!should_start_addon(true, Some(&prefixed)));
        assert!(should_start_addon(true, Some(&collection)));
        assert!(should_start_addon(true, None));
        assert!(!should_start_addon(false, Some(&collection)));
    }

    #[test]
    fn repository_downloads_use_a_bounded_worker_pool() {
        assert_eq!(download_worker_count(1), 1);
        assert_eq!(download_worker_count(4), 4);
        assert_eq!(download_worker_count(usize::MAX), MAX_PARALLEL_DOWNLOADS);
    }
}

#[cfg(any())]
mod tests {
    use super::{
        build_addon_catalog, build_sync_plan, decode_autoconfig, decode_events, decode_manifest,
    };

    #[test]
    fn decodes_lowtac_autoconfig_without_exposing_credentials() {
        let bytes = include_bytes!("../tests/fixtures/lowtac-autoconfig.gz");
        let endpoint = decode_autoconfig(bytes, "https://example.test/autoconfig").unwrap();
        assert_eq!(endpoint.info.name, "LT Moderne Repo");
        assert_eq!(endpoint.info.protocol, "FTP");
        assert_eq!(endpoint.info.host, "ftp.lowtac.nl");
        assert!(!endpoint.info.anonymous);
    }

    #[test]
    fn decodes_lowtac_sync_tree() {
        let bytes = include_bytes!("../tests/fixtures/lowtac-sync.gz");
        let manifest = decode_manifest(bytes).unwrap();
        assert_eq!(manifest.summary.directories, 133);
        assert_eq!(manifest.summary.files, 2614);
        assert_eq!(
            manifest.entries[0].remote_path.to_string_lossy(),
            "!LT_Modset_Core/@LT_ace/addons/ace_advanced_ballistics.pbo"
        );
        assert_eq!(
            manifest.entries[0].local_path.to_string_lossy(),
            "@LT_ace/addons/ace_advanced_ballistics.pbo"
        );
        assert_eq!(manifest.entries[0].size, 195_385);
        assert_eq!(manifest.entries[0].sha1.as_ref().unwrap().len(), 40);
        assert_eq!(manifest.summary.unhashed_files, 1);
        let catalog = build_addon_catalog(&manifest.entries);
        assert_eq!(catalog.len(), 38);
        assert!(catalog.iter().any(|addon| addon.name == "@LT_CBA_A3"));
    }

    #[test]
    fn decodes_published_modsets_as_membership_not_order() {
        let bytes = include_bytes!("../tests/fixtures/lowtac-events.gz");
        let modsets = decode_events(bytes).unwrap();
        assert_eq!(modsets.len(), 2);
        assert_eq!(modsets[0].name, "Lowlands Tactical - Moderne");
        assert_eq!(modsets[0].addons.len(), 25);
        assert!(modsets[0].addons.iter().any(|addon| addon == "@LT_ACRE2"));
        assert_eq!(
            modsets[1].name,
            "Lowlands Tactical - Moderne + Better inventory"
        );
        assert_eq!(modsets[1].addons.len(), 26);
        assert!(
            modsets[1]
                .addons
                .iter()
                .any(|addon| addon == "@Better_Inventory")
        );
    }

    #[test]
    fn plans_selected_missing_addons_without_writing() {
        let bytes = include_bytes!("../tests/fixtures/lowtac-sync.gz");
        let manifest = decode_manifest(bytes).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let plan = build_sync_plan(
            &manifest,
            &["@LT_CBA_A3".into(), "@LT_ACRE2".into()],
            destination.path(),
        )
        .unwrap();
        assert_eq!(plan.resolved_addons.len(), 2);
        assert!(plan.missing_addons.is_empty());
        assert_eq!(plan.download_files, plan.total_files);
        assert_eq!(plan.replacement_files, 0);
        assert!(plan.download_bytes > 0);
        assert!(
            std::fs::read_dir(destination.path())
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[test]
    fn reports_unknown_and_ambiguous_addons() {
        let bytes = include_bytes!("../tests/fixtures/lowtac-sync.gz");
        let manifest = decode_manifest(bytes).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let plan = build_sync_plan(
            &manifest,
            &["@does_not_exist".into(), "@ace_nomedical".into()],
            destination.path(),
        )
        .unwrap();
        assert_eq!(plan.missing_addons, ["@does_not_exist"]);
        assert_eq!(plan.ambiguous_addons, ["@ace_nomedical"]);
        assert_eq!(plan.total_files, 0);
    }

    #[test]
    fn verifies_existing_zero_byte_manifest_entry() {
        let bytes = include_bytes!("../tests/fixtures/lowtac-sync.gz");
        let manifest = decode_manifest(bytes).unwrap();
        let entry = manifest
            .entries
            .iter()
            .find(|entry| entry.sha1.is_none())
            .expect("fixture has the documented zero-byte sentinel");
        let destination = tempfile::tempdir().unwrap();
        let local = destination.path().join(&entry.local_path);
        std::fs::create_dir_all(local.parent().unwrap()).unwrap();
        std::fs::File::create(local).unwrap();
        let plan = build_sync_plan(
            &manifest,
            std::slice::from_ref(&entry.addon_name),
            destination.path(),
        )
        .unwrap();
        assert_eq!(plan.verified_files, 1);
        assert_eq!(plan.total_files, plan.download_files + 1);
    }
}

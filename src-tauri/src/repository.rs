//! Repository orchestration and shared job state.
mod decoding;
mod installation;
mod planning;
#[cfg(test)]
mod tests;
mod transport;
use decoding::*;
use installation::*;
use planning::*;
use transport::*;
pub(crate) mod filesystem;
use filesystem::Directory;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::net::ToSocketAddrs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use flate2::read::GzDecoder;
use jaded::{Content, ObjectData, Parser, PrimitiveType, Value};
use sha1::{Digest, Sha1};
use suppaftp::{FtpError, FtpStream, types::FileType};
use url::Url;

use crate::model::{
    AddonCatalogEntry, CheckPhase, CheckProgress, ManifestSummary, PublishedModset, RepositoryInfo,
    RepositorySnapshot, SyncAction, SyncPhase, SyncPlan, SyncPlanItem, SyncProgress, SyncResult,
};

const MAX_AUTOCONFIG_SIZE: usize = 1024 * 1024;
const MAX_MANIFEST_SIZE: usize = 64 * 1024 * 1024;
const MAX_PARALLEL_DOWNLOADS: usize = 8;
const HTTPS_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HTTPS_READ_TIMEOUT: Duration = Duration::from_secs(30);
/// How often the file check reports back while hashing.
const REPORT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(120);

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("the auto-config URL must use HTTPS or HTTP")]
    InsecureUrl,
    #[error("invalid auto-config URL: {0}")]
    InvalidUrl(String),
    #[error("could not download auto-config: {0}")]
    Download(String),
    #[error("repository data exceeds its expected size limit")]
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
        let _guard = self
            .wait_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.paused.store(true, Ordering::Release);
    }

    pub fn resume(&self) {
        let _guard = self
            .wait_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.paused.store(false, Ordering::Release);
        self.wait_signal.notify_all();
    }

    pub fn cancel(&self) {
        let _guard = self
            .wait_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
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
    let transfer = make_transfer_endpoint(&endpoint)?;
    let (manifest, published_modsets) =
        tokio::task::spawn_blocking(move || fetch_repository_metadata(&transfer))
            .await
            .map_err(|error| RepositoryError::Transfer(error.to_string()))??;
    let addons = build_addon_catalog(&manifest.entries);
    Ok(RepositorySnapshot {
        repository: endpoint.info,
        manifest: manifest.summary,
        published_modsets,
        addons,
    })
}

pub async fn plan_sync<F: Fn(CheckProgress) + Send + 'static>(
    source_url: &str,
    selected_addons: Vec<String>,
    destination: PathBuf,
    full_verification: bool,
    control: Arc<SyncControl>,
    on_progress: F,
) -> Result<SyncPlan, RepositoryError> {
    // Fetching the file list happens before any per-file counts exist, and on a
    // large repository it is not quick.
    on_progress(CheckProgress {
        phase: CheckPhase::Metadata,
        addon: None,
        checked_files: 0,
        total_files: 0,
        checked_bytes: 0,
        total_bytes: 0,
    });
    let endpoint = download_autoconfig(source_url).await?;
    let transfer = make_transfer_endpoint(&endpoint)?;
    tokio::task::spawn_blocking(move || {
        let root = Directory::open(&destination).map_err(local_error)?;
        let _lock = root.lock().map_err(local_error)?;
        control.checkpoint()?;
        let (manifest, _) = fetch_repository_metadata(&transfer)?;
        build_sync_plan_controlled(
            &manifest,
            &selected_addons,
            &root,
            full_verification,
            &control,
            &on_progress,
        )
    })
    .await
    .map_err(|error| RepositoryError::Local(error.to_string()))?
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransferProtocol {
    Ftp,
    Https,
}

#[derive(Clone)]
struct TransferEndpoint {
    protocol: TransferProtocol,
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
    let transfer = make_transfer_endpoint(&endpoint)?;
    tokio::task::spawn_blocking(move || {
        let root = Directory::open(&destination).map_err(local_error)?;
        let _lock = root.lock().map_err(local_error)?;
        recover_install(&root, &control)?;
        control.checkpoint()?;
        let (manifest, _) = fetch_repository_metadata(&transfer)?;
        let plan = build_sync_plan_controlled(
            &manifest,
            &selected_addons,
            &root,
            false,
            &control,
            &|_| {},
        )?;
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
            &root,
            &control,
            &on_progress,
        )
    })
    .await
    .map_err(|error| RepositoryError::Sync(error.to_string()))?
}

fn local_error(error: std::io::Error) -> RepositoryError {
    RepositoryError::Local(error.to_string())
}

fn sha1_reader(mut file: std::fs::File, control: &SyncControl) -> Result<String, RepositoryError> {
    let mut digest = Sha1::new();
    let mut buffer = [0u8; 256 * 1024];
    loop {
        control.checkpoint()?;
        let count = file.read(&mut buffer).map_err(local_error)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

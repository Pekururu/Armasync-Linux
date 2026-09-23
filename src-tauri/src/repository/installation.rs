use super::*;

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct PendingFile {
    pub(super) target: PathBuf,
    pub(super) staged: PathBuf,
    pub(super) size: u64,
    pub(super) sha1: Option<String>,
}

pub(super) const JOURNAL: &str = ".armasync/install.json";

pub(super) fn staging_path(entry: &ManifestEntry) -> PathBuf {
    let mut digest = Sha1::new();
    digest.update(entry.local_path.as_os_str().as_encoded_bytes());
    digest.update(entry.size.to_le_bytes());
    digest.update(entry.sha1.as_deref().unwrap_or("").as_bytes());
    PathBuf::from(format!(".armasync/staging/{:x}.ready", digest.finalize()))
}

pub(super) fn verify_file(
    root: &Directory,
    path: &Path,
    size: u64,
    expected: Option<&str>,
    control: &SyncControl,
) -> Result<(), RepositoryError> {
    let file = root.read(path).map_err(local_error)?;
    if file.metadata().map_err(local_error)?.len() != size {
        return Err(RepositoryError::Sync(format!(
            "size mismatch for {}",
            path.display()
        )));
    }
    if let Some(expected) = expected {
        if !sha1_reader(file, control)?.eq_ignore_ascii_case(expected) {
            return Err(RepositoryError::Sync(format!(
                "SHA-1 mismatch for {}",
                path.display()
            )));
        }
    } else if size != 0 {
        return Err(RepositoryError::Sync(
            "cannot install an unhashed nonempty file".into(),
        ));
    }
    Ok(())
}

pub(super) fn recover_install(
    root: &Directory,
    control: &SyncControl,
) -> Result<(), RepositoryError> {
    recover_install_reporting(root, control, &|_, _, _| {})
}

fn recover_install_reporting(
    root: &Directory,
    control: &SyncControl,
    report: &impl Fn(usize, usize, &Path),
) -> Result<(), RepositoryError> {
    let file = match root.read(Path::new(JOURNAL)) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(local_error(error)),
    };
    if file.metadata().map_err(local_error)?.len() > MAX_MANIFEST_SIZE as u64 {
        return Err(RepositoryError::TooLarge);
    }
    let pending: Vec<PendingFile> = serde_json::from_reader(file)
        .map_err(|error| RepositoryError::Sync(format!("invalid install journal: {error}")))?;
    for (index, entry) in pending.iter().enumerate() {
        let first = entry.target.components().next();
        if !matches!(first, Some(Component::Normal(name)) if name.to_string_lossy().starts_with('@'))
            || !entry.staged.starts_with(".armasync/staging")
        {
            return Err(RepositoryError::UnsafePath(
                entry.target.display().to_string(),
            ));
        }
        control.checkpoint()?;
        // A crash after rename but before journal removal is safe to replay.
        match root.read(&entry.staged) {
            Ok(_) => {
                verify_file(
                    root,
                    &entry.staged,
                    entry.size,
                    entry.sha1.as_deref(),
                    control,
                )?;
                root.rename(&entry.staged, &entry.target)
                    .map_err(local_error)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                verify_file(
                    root,
                    &entry.target,
                    entry.size,
                    entry.sha1.as_deref(),
                    control,
                )?;
            }
            Err(error) => return Err(local_error(error)),
        }
        report(index + 1, pending.len(), &entry.target);
    }
    root.remove(Path::new(JOURNAL)).map_err(local_error)
}

pub(super) fn download_and_install<F>(
    endpoint: &TransferEndpoint,
    manifest: &SyncManifest,
    plan: &SyncPlan,
    destination: &Path,
    root: &Directory,
    control: &SyncControl,
    on_progress: &F,
) -> Result<SyncResult, RepositoryError>
where
    F: Fn(SyncProgress) + Sync,
{
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
    entries.sort_unstable_by_key(|entry| std::cmp::Reverse(entry.size));
    let mut downloads = Vec::new();
    for entry in &entries {
        control.checkpoint()?;
        let staged = staging_path(entry);
        if verify_file(root, &staged, entry.size, entry.sha1.as_deref(), control).is_err() {
            control.checkpoint()?;
            match root.remove(&staged) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(local_error(error)),
            }
            match root.remove(&staged.with_extension("part")) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(local_error(error)),
            }
            downloads.push(*entry);
        }
    }
    let transfer_bytes = downloads
        .iter()
        .fold(0u64, |sum, entry| sum.saturating_add(entry.size));
    if !downloads.is_empty() {
        let available = fs2::available_space(destination).map_err(local_error)?;
        let required = transfer_bytes.saturating_add(512 * 1024 * 1024);
        if available < required {
            return Err(RepositoryError::Sync(format!(
                "insufficient free space: {available} bytes available, {required} bytes required including safety margin"
            )));
        }
        // Completed files survive failure/cancellation; partial files are replaced on retry.
        stage_downloads(
            endpoint,
            &downloads,
            root,
            transfer_bytes,
            control,
            on_progress,
        )?;
    }
    if !entries.is_empty() {
        control.checkpoint()?;
        let pending = entries
            .iter()
            .map(|entry| PendingFile {
                target: entry.local_path.clone(),
                staged: staging_path(entry),
                size: entry.size,
                sha1: entry.sha1.clone(),
            })
            .collect::<Vec<_>>();
        root.write_atomic(
            Path::new(JOURNAL),
            &serde_json::to_vec(&pending)
                .map_err(|error| RepositoryError::Sync(error.to_string()))?,
        )
        .map_err(local_error)?;
        on_progress(SyncProgress {
            phase: SyncPhase::Installing,
            downloaded_bytes: transfer_bytes,
            total_bytes: transfer_bytes,
            completed_files: 0,
            total_files: entries.len(),
            current_file: None,
        });
        recover_install_reporting(root, control, &|completed, total, path| {
            on_progress(SyncProgress {
                phase: SyncPhase::Installing,
                downloaded_bytes: transfer_bytes,
                total_bytes: transfer_bytes,
                completed_files: completed,
                total_files: total,
                current_file: Some(path.to_string_lossy().into_owned()),
            });
        })?;
    }
    Ok(SyncResult {
        installed_files: entries.len(),
        downloaded_bytes: transfer_bytes,
        destination: destination.to_string_lossy().into_owned(),
    })
}

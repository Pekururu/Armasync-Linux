use super::*;

pub(super) fn build_addon_catalog(entries: &[ManifestEntry]) -> Vec<AddonCatalogEntry> {
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

#[cfg(test)]
pub(super) fn build_sync_plan<F: Fn(CheckProgress)>(
    manifest: &SyncManifest,
    selected: &[String],
    destination: &Path,
    progress: &F,
) -> Result<SyncPlan, RepositoryError> {
    let root = Directory::open(destination).map_err(local_error)?;
    build_sync_plan_controlled(
        manifest,
        selected,
        &root,
        false,
        &SyncControl::new(),
        progress,
    )
}

pub(super) fn build_sync_plan_controlled<F: Fn(CheckProgress)>(
    manifest: &SyncManifest,
    selected_addons: &[String],
    destination: &Directory,
    full_verification: bool,
    control: &SyncControl,
    on_progress: &F,
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

    let selected_entries: Vec<&ManifestEntry> = manifest
        .entries
        .iter()
        .filter(|entry| resolved_names.contains(&entry.addon_name.to_ascii_lowercase()))
        .collect();
    let total_files = selected_entries.len();
    let total_bytes = selected_entries
        .iter()
        .fold(0u64, |sum, entry| sum.saturating_add(entry.size));
    on_progress(CheckProgress {
        phase: CheckPhase::Verifying,
        addon: None,
        checked_files: 0,
        total_files,
        checked_bytes: 0,
        total_bytes,
    });

    // Deciding what to do with a file is cheap; hashing it is not. Settle every
    // cheap case first, then hash what is left across several threads. The rules
    // below must stay identical to the sequential form they replaced — a file
    // judged verified here is a file the sync will not re-download.
    enum Verdict {
        Act(SyncAction),
        Verified,
        Hash,
    }
    let mut cache = crate::check_cache::Cache::load(destination);
    let mut verdicts = Vec::with_capacity(selected_entries.len());
    let mut to_hash: Vec<usize> = Vec::new();
    let mut stamps: Vec<Option<(i64, u32)>> = vec![None; selected_entries.len()];
    for (index, entry) in selected_entries.iter().enumerate() {
        control.checkpoint()?;
        verdicts.push(
            match destination
                .read(&entry.local_path)
                .and_then(|file| file.metadata())
            {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Verdict::Act(SyncAction::Download)
                }
                Err(error) => return Err(RepositoryError::Local(error.to_string())),
                Ok(metadata) if !metadata.is_file() || metadata.len() != entry.size => {
                    Verdict::Act(SyncAction::Replace)
                }
                Ok(metadata) => match &entry.sha1 {
                    Some(expected) => {
                        let modified = crate::check_cache::modified_at(&metadata);
                        stamps[index] = modified;
                        let key = entry.local_path.to_string_lossy();
                        match if full_verification {
                            None
                        } else {
                            cache.hash_of(&key, entry.size, modified)
                        } {
                            // Unchanged since it was last hashed, so its hash is
                            // known; the comparison still happens.
                            Some(known) if known.eq_ignore_ascii_case(expected) => {
                                Verdict::Verified
                            }
                            Some(_) => Verdict::Act(SyncAction::Replace),
                            None => {
                                to_hash.push(index);
                                Verdict::Hash
                            }
                        }
                    }
                    // No published hash: only an empty file can be taken on trust.
                    None if entry.size == 0 => Verdict::Verified,
                    None => Verdict::Act(SyncAction::Replace),
                },
            },
        );
    }

    let settled = total_files - to_hash.len();
    let mut hash_matches: Vec<bool> = vec![false; selected_entries.len()];
    if !to_hash.is_empty() {
        let cursor = std::sync::atomic::AtomicUsize::new(0);
        let hashed = std::sync::atomic::AtomicUsize::new(0);
        let hashed_bytes = std::sync::atomic::AtomicU64::new(0);
        let settled_bytes = selected_entries
            .iter()
            .enumerate()
            .filter(|(index, _)| !matches!(verdicts[*index], Verdict::Hash))
            .fold(0u64, |sum, (_, entry)| sum.saturating_add(entry.size));

        // Reading is the limit once hashing is spread out, so more threads than
        // this buys nothing and costs seeks on a spinning disk.
        let workers = std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(4)
            .min(8)
            .min(to_hash.len());

        let take_next = || -> Option<usize> {
            if control.cancelled.load(Ordering::Acquire) {
                return None;
            }
            let slot = cursor.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            to_hash.get(slot).copied()
        };
        let hash_one = |index: usize| -> Result<(usize, String), RepositoryError> {
            let entry = selected_entries[index];
            let actual = sha1_reader(
                destination.read(&entry.local_path).map_err(local_error)?,
                control,
            )?;
            hashed.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            hashed_bytes.fetch_add(entry.size, std::sync::atomic::Ordering::Relaxed);
            Ok((index, actual))
        };

        let collected: Vec<Result<(usize, String), RepositoryError>> =
            std::thread::scope(|scope| {
                let handles: Vec<_> = (1..workers)
                    .map(|_| {
                        scope.spawn(|| {
                            let mut local = Vec::new();
                            while let Some(index) = take_next() {
                                local.push(hash_one(index));
                            }
                            local
                        })
                    })
                    .collect();

                // This thread hashes too, and is the only one that reports, so the
                // callback never has to be shared across threads.
                let mut mine = Vec::new();
                let mut last_report = std::time::Instant::now();
                while let Some(index) = take_next() {
                    mine.push(hash_one(index));
                    if last_report.elapsed() >= REPORT_INTERVAL {
                        last_report = std::time::Instant::now();
                        let done = hashed.load(std::sync::atomic::Ordering::Relaxed);
                        on_progress(CheckProgress {
                            phase: CheckPhase::Verifying,
                            addon: Some(selected_entries[index].addon_name.clone()),
                            checked_files: settled + done,
                            total_files,
                            checked_bytes: settled_bytes.saturating_add(
                                hashed_bytes.load(std::sync::atomic::Ordering::Relaxed),
                            ),
                            total_bytes,
                        });
                    }
                }
                for handle in handles {
                    match handle.join() {
                        Ok(results) => mine.extend(results),
                        Err(_) => {
                            mine.push(Err(RepositoryError::Local("hash worker panicked".into())))
                        }
                    }
                }
                mine
            });

        for outcome in collected {
            let (index, actual) = outcome?;
            let entry = selected_entries[index];
            let expected = entry.sha1.as_ref().expect("only hashed entries are queued");
            hash_matches[index] = actual.eq_ignore_ascii_case(expected);
            cache.remember(
                &entry.local_path.to_string_lossy(),
                entry.size,
                stamps[index],
                actual,
            );
        }
    }

    control.checkpoint()?;
    for (index, entry) in selected_entries.iter().enumerate() {
        plan.total_files += 1;
        plan.final_bytes = plan.final_bytes.saturating_add(entry.size);
        let action = match &verdicts[index] {
            Verdict::Act(action) => Some(action.clone()),
            Verdict::Verified => None,
            Verdict::Hash if hash_matches[index] => None,
            Verdict::Hash => Some(SyncAction::Replace),
        };
        if action.is_none() {
            plan.verified_files += 1;
        }

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

    cache.save(destination);
    on_progress(CheckProgress {
        phase: CheckPhase::Verifying,
        addon: None,
        checked_files: total_files,
        total_files,
        checked_bytes: total_bytes,
        total_bytes,
    });

    Ok(plan)
}

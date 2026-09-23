use super::*;

#[cfg(test)]
mod sync_control_tests {
    use super::{
        AddonContext, Digest, MAX_PARALLEL_DOWNLOADS, ManifestEntry, RepositoryError, Sha1,
        SyncControl, SyncCoordinator, SyncManifest, TransferEndpoint, TransferProtocol,
        build_sync_plan, download_worker_count, https_resource_url, should_start_addon,
        stream_exact,
    };
    use crate::model::ManifestSummary;
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

    #[test]
    fn https_urls_keep_the_repository_path_and_escape_file_names() {
        let endpoint = TransferEndpoint {
            protocol: TransferProtocol::Https,
            host: "repo.example/root".into(),
            port: 8443,
            login: String::new(),
            password: String::new(),
        };
        let url = https_resource_url(&endpoint, "@Addon/a file#1.pbo").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.port(), Some(8443));
        assert_eq!(url.path(), "/root/@Addon/a%20file%231.pbo");
        assert!(url.query().is_none());
        assert!(url.fragment().is_none());
    }

    #[test]
    fn https_urls_reject_a_downgrade_to_plain_http() {
        let endpoint = TransferEndpoint {
            protocol: TransferProtocol::Https,
            host: "http://repo.example/root".into(),
            port: 443,
            login: String::new(),
            password: String::new(),
        };
        assert!(https_resource_url(&endpoint, ".a3s/sync").is_err());
    }

    #[test]
    fn streamed_downloads_reject_truncated_and_oversized_files() {
        let mut truncated = std::io::Cursor::new(b"abc");
        let mut written = Vec::new();
        let error = stream_exact(
            &mut truncated,
            &mut written,
            4,
            "file",
            || Ok(()),
            |_| Ok(()),
        )
        .unwrap_err();
        assert!(matches!(error, RepositoryError::Transfer(_)));

        let mut oversized = std::io::Cursor::new(b"abcde");
        let mut written = Vec::new();
        let error = stream_exact(
            &mut oversized,
            &mut written,
            4,
            "file",
            || Ok(()),
            |_| Ok(()),
        )
        .unwrap_err();
        assert!(matches!(error, RepositoryError::TooLarge));
    }

    #[test]
    fn streamed_downloads_check_control_and_report_each_chunk() {
        let contents = vec![7_u8; 300 * 1024];
        let mut reader = std::io::Cursor::new(&contents);
        let mut written = Vec::new();
        let checks = std::cell::Cell::new(0);
        let reported = std::cell::Cell::new(0_usize);
        stream_exact(
            &mut reader,
            &mut written,
            contents.len() as u64,
            "file",
            || {
                checks.set(checks.get() + 1);
                Ok(())
            },
            |count| {
                reported.set(reported.get() + count);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(written, contents);
        assert_eq!(reported.get(), contents.len());
        assert!(checks.get() >= 3, "control is checked before every read");
    }

    /// The repository fixtures this file's other tests want are not in the
    /// repo, so build a manifest by hand rather than skipping the check.
    fn manifest_of(sizes: &[u64]) -> SyncManifest {
        let entries: Vec<ManifestEntry> = sizes
            .iter()
            .enumerate()
            .map(|(index, size)| ManifestEntry {
                remote_path: PathBuf::from(format!("@Addon/file{index}.pbo")),
                local_path: PathBuf::from(format!("@Addon/file{index}.pbo")),
                addon_name: "@Addon".into(),
                addon_remote_root: PathBuf::from("@Addon"),
                size: *size,
                compressed_size: 0,
                sha1: Some("a".repeat(40)),
                compressed: false,
            })
            .collect();
        SyncManifest {
            summary: ManifestSummary {
                directories: 1,
                files: entries.len(),
                total_bytes: sizes.iter().sum(),
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 0,
            },
            entries,
        }
    }

    /// Removes its directory on drop, so a failing assertion cannot leave a
    /// scratch tree behind. There is no tempfile dependency in this crate.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "armasync-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Scratch(path)
        }

        fn write(&self, relative: &str, contents: &[u8]) {
            let full = self.0.join(relative);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, contents).unwrap();
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn sha1_of(contents: &[u8]) -> String {
        let mut digest = Sha1::new();
        digest.update(contents);
        format!("{:x}", digest.finalize())
    }

    fn entry_of(name: &str, size: u64, sha1: Option<String>) -> ManifestEntry {
        ManifestEntry {
            remote_path: PathBuf::from(format!("@Addon/{name}")),
            local_path: PathBuf::from(format!("@Addon/{name}")),
            addon_name: "@Addon".into(),
            addon_remote_root: PathBuf::from("@Addon"),
            size,
            compressed_size: 0,
            sha1,
            compressed: false,
        }
    }

    #[test]
    fn hashing_in_parallel_reaches_the_same_verdicts_as_checking_one_by_one() {
        let scratch = Scratch::new("verdicts");
        let good = b"identical on both sides".to_vec();
        let local = b"same length, different!".to_vec();
        let remote = b"same length, DIFFERENT?".to_vec();
        assert_eq!(
            local.len(),
            remote.len(),
            "the stale case must survive the size check"
        );

        scratch.write("@Addon/match.pbo", &good);
        scratch.write("@Addon/stale.pbo", &local);
        scratch.write("@Addon/empty.pbo", b"");
        // @Addon/absent.pbo is deliberately not written.

        let entries = vec![
            entry_of("match.pbo", good.len() as u64, Some(sha1_of(&good))),
            entry_of("stale.pbo", remote.len() as u64, Some(sha1_of(&remote))),
            entry_of("absent.pbo", 12, Some(sha1_of(b"anything"))),
            entry_of("empty.pbo", 0, None),
        ];
        let manifest = SyncManifest {
            summary: crate::model::ManifestSummary {
                directories: 1,
                files: entries.len(),
                total_bytes: entries.iter().map(|entry| entry.size).sum(),
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 1,
            },
            entries,
        };

        let plan = build_sync_plan(&manifest, &["@Addon".into()], &scratch.0, &|_| {}).unwrap();

        assert_eq!(plan.total_files, 4);
        assert_eq!(
            plan.verified_files, 2,
            "matching hash and empty unhashed file"
        );
        assert_eq!(plan.download_files, 1, "the file that is not there");
        assert_eq!(plan.replacement_files, 1, "same size, different content");

        // Order must follow the manifest, not the order hashing happened to finish.
        let paths: Vec<&str> = plan
            .operations
            .iter()
            .map(|operation| operation.relative_path.as_str())
            .collect();
        assert_eq!(paths, ["@Addon/stale.pbo", "@Addon/absent.pbo"]);
    }

    fn write_cache(scratch: &Scratch, relative: &str, sha1: &str) {
        let full = scratch.0.join(relative);
        let metadata = std::fs::metadata(&full).unwrap();
        let (secs, nanos) = crate::check_cache::modified_at(&metadata).unwrap();
        let body = format!(
            r#"{{"files":{{"{relative}":{{"size":{},"mtime_secs":{secs},"mtime_nanos":{nanos},"sha1":"{sha1}"}}}}}}"#,
            metadata.len()
        );
        std::fs::create_dir_all(scratch.0.join(".armasync")).unwrap();
        std::fs::write(scratch.0.join(".armasync/verified-files.json"), body).unwrap();
    }

    #[test]
    fn an_unchanged_file_is_judged_from_the_remembered_hash() {
        let scratch = Scratch::new("memo-hit");
        let contents = b"unchanged since the last check".to_vec();
        scratch.write("@Addon/match.pbo", &contents);

        // The file on disk matches the manifest. The memo says otherwise, and
        // the memo is what decides — which is only true if it was consulted.
        write_cache(&scratch, "@Addon/match.pbo", &"b".repeat(40));
        let manifest = SyncManifest {
            summary: crate::model::ManifestSummary {
                directories: 1,
                files: 1,
                total_bytes: contents.len() as u64,
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 0,
            },
            entries: vec![entry_of(
                "match.pbo",
                contents.len() as u64,
                Some(sha1_of(&contents)),
            )],
        };

        let plan = build_sync_plan(&manifest, &["@Addon".into()], &scratch.0, &|_| {}).unwrap();
        assert_eq!(plan.replacement_files, 1, "the remembered hash was ignored");
        assert_eq!(plan.verified_files, 0);
    }

    #[test]
    fn a_touched_file_is_hashed_again_rather_than_remembered() {
        let scratch = Scratch::new("memo-miss");
        let contents = b"unchanged since the last check".to_vec();
        scratch.write("@Addon/match.pbo", &contents);
        write_cache(&scratch, "@Addon/match.pbo", &"b".repeat(40));

        // Same bytes, different timestamp: the memo no longer applies, so the
        // file is read and found to be correct after all.
        let full = scratch.0.join("@Addon/match.pbo");
        let handle = std::fs::File::options().write(true).open(&full).unwrap();
        let moved = std::time::SystemTime::now() + std::time::Duration::from_secs(120);
        handle
            .set_times(std::fs::FileTimes::new().set_modified(moved))
            .unwrap();

        let manifest = SyncManifest {
            summary: crate::model::ManifestSummary {
                directories: 1,
                files: 1,
                total_bytes: contents.len() as u64,
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 0,
            },
            entries: vec![entry_of(
                "match.pbo",
                contents.len() as u64,
                Some(sha1_of(&contents)),
            )],
        };

        let plan = build_sync_plan(&manifest, &["@Addon".into()], &scratch.0, &|_| {}).unwrap();
        assert_eq!(
            plan.verified_files, 1,
            "a touched file must be re-read, not trusted"
        );
        assert_eq!(plan.replacement_files, 0);

        // And the corrected hash replaces the stale one for next time.
        let saved =
            std::fs::read_to_string(scratch.0.join(".armasync/verified-files.json")).unwrap();
        assert!(
            saved.contains(&sha1_of(&contents)),
            "the memo was not updated"
        );
    }

    #[test]
    fn the_file_check_reports_progress_that_reaches_its_own_total() {
        let manifest = manifest_of(&[10, 20, 30, 40]);
        // Nothing is installed at this path, so every entry resolves without
        // hashing and the plan is pure "download".
        let temporary = tempfile::tempdir().unwrap();
        let destination = temporary.path().to_owned();
        let reports = std::sync::Mutex::new(Vec::new());
        let plan = build_sync_plan(&manifest, &["@Addon".into()], &destination, &|progress| {
            reports.lock().unwrap().push(progress)
        })
        .unwrap();

        let reports = reports.into_inner().unwrap();
        assert!(!reports.is_empty(), "verifying must report at least once");
        assert!(reports.iter().all(|r| r.checked_files <= r.total_files));
        let last = reports.last().unwrap();
        // A bar that stops short of its own total reads as a hang.
        assert_eq!(last.checked_files, last.total_files);
        assert_eq!(last.total_files, plan.total_files);
        assert_eq!(last.checked_bytes, last.total_bytes);
        assert_eq!(last.total_bytes, 100);
    }
}

#[cfg(test)]
mod compatibility_tests {
    use super::*;
    fn manifest() -> SyncManifest {
        decode_manifest(include_bytes!("../../tests/fixtures/sync.gz")).unwrap()
    }
    #[test]
    fn decodes_synthetic_autoconfig_without_exposing_credentials() {
        let endpoint = decode_autoconfig(
            include_bytes!("../../tests/fixtures/autoconfig.gz"),
            "https://example.test/autoconfig",
        )
        .unwrap();
        assert_eq!(endpoint.info.name, "Synthetic repository");
        assert_eq!(endpoint.info.protocol, "FTP");
        assert_eq!(endpoint.info.host, "repo.example.test");
        assert!(!endpoint.info.anonymous);
        let public = serde_json::to_string(&endpoint.info).unwrap();
        assert!(!public.contains("fixture-user"));
        assert!(!public.contains("not-a-real-password"));
    }
    #[test]
    fn decodes_sync_tree_and_catalog() {
        let manifest = manifest();
        assert_eq!(manifest.summary.files, 5);
        assert_eq!(manifest.summary.unhashed_files, 1);
        assert_eq!(
            manifest.entries[0].remote_path,
            Path::new("collection/@Alpha/addons/example.pbo")
        );
        assert_eq!(
            manifest.entries[0].local_path,
            Path::new("@Alpha/addons/example.pbo")
        );
        assert_eq!(manifest.entries[0].size, 12);
        assert_eq!(build_addon_catalog(&manifest.entries).len(), 4);
    }
    #[test]
    fn decodes_published_modsets_as_membership_not_order() {
        let events = decode_events(include_bytes!("../../tests/fixtures/events.gz")).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].name, "Unit");
        assert_eq!(events[1].addons, ["@Alpha", "@Bravo"]);
        assert_eq!(events[1].userconfig_folders, ["test-config"]);
    }
    #[test]
    fn plans_missing_addons_without_writing_files() {
        let root = tempfile::tempdir().unwrap();
        let plan = build_sync_plan(
            &manifest(),
            &["@Alpha".into(), "@Bravo".into()],
            root.path(),
            &|_| {},
        )
        .unwrap();
        assert_eq!(plan.total_files, 3);
        assert_eq!(plan.download_files, 3);
        assert!(std::fs::read_dir(root.path()).unwrap().next().is_none());
    }
    #[test]
    fn reports_unknown_and_ambiguous_addons() {
        let root = tempfile::tempdir().unwrap();
        let plan = build_sync_plan(
            &manifest(),
            &["@Unknown".into(), "@Duplicate".into()],
            root.path(),
            &|_| {},
        )
        .unwrap();
        assert_eq!(plan.missing_addons, ["@Unknown"]);
        assert_eq!(plan.ambiguous_addons, ["@Duplicate"]);
        assert_eq!(plan.total_files, 0);
    }
    #[test]
    fn verifies_zero_byte_sentinel() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("@Alpha")).unwrap();
        std::fs::write(temp.path().join("@Alpha/empty.txt"), b"").unwrap();
        let plan = build_sync_plan(&manifest(), &["@Alpha".into()], temp.path(), &|_| {}).unwrap();
        assert_eq!(plan.verified_files, 1);
        assert_eq!(plan.download_files, 1);
    }
    #[test]
    fn rejects_unsafe_serialized_paths() {
        assert!(matches!(
            decode_manifest(include_bytes!("../../tests/fixtures/unsafe-sync.gz")),
            Err(RepositoryError::UnsafePath(_))
        ));
    }
}

#[cfg(test)]
mod reliability_tests {
    use super::*;

    #[test]
    fn resume_and_cancel_serialize_with_wait_predicate() {
        for cancel in [false, true] {
            let control = Arc::new(SyncControl::new());
            control.pause();
            let guard = control.wait_lock.lock().unwrap();
            let copy = control.clone();
            let (started_tx, started_rx) = std::sync::mpsc::channel();
            let (done_tx, done_rx) = std::sync::mpsc::channel();
            let worker = std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                if cancel {
                    copy.cancel();
                } else {
                    copy.resume();
                }
                done_tx.send(()).unwrap();
            });
            started_rx.recv().unwrap();
            assert!(done_rx.recv_timeout(Duration::from_millis(25)).is_err());
            assert!(control.paused.load(Ordering::Acquire));
            drop(guard);
            done_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            worker.join().unwrap();
            assert!(!control.paused.load(Ordering::Acquire));
        }
    }

    fn entry(name: &str, contents: &[u8]) -> ManifestEntry {
        ManifestEntry {
            remote_path: format!("@Test/{name}").into(),
            local_path: format!("@Test/{name}").into(),
            addon_name: "@Test".into(),
            addon_remote_root: "@Test".into(),
            size: contents.len() as u64,
            compressed_size: 0,
            sha1: Some(format!("{:x}", Sha1::digest(contents))),
            compressed: false,
        }
    }

    #[test]
    fn full_verification_detects_changes_with_preserved_size_and_mtime() {
        let temp = tempfile::tempdir().unwrap();
        let root = Directory::open(temp.path()).unwrap();
        root.write_atomic(Path::new("@Test/file"), b"good").unwrap();
        let manifest = SyncManifest {
            summary: ManifestSummary {
                directories: 1,
                files: 1,
                total_bytes: 4,
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 0,
            },
            entries: vec![entry("file", b"good")],
        };
        let control = SyncControl::new();
        let check = |full| {
            build_sync_plan_controlled(&manifest, &["@Test".into()], &root, full, &control, &|_| {})
                .unwrap()
        };
        assert_eq!(check(false).verified_files, 1);
        let path = temp.path().join("@Test/file");
        let mtime = std::fs::metadata(&path).unwrap().modified().unwrap();
        std::fs::write(&path, b"evil").unwrap();
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(mtime))
            .unwrap();
        assert_eq!(check(false).verified_files, 1);
        assert_eq!(check(true).replacement_files, 1);
        assert_eq!(check(false).replacement_files, 1);
    }

    #[test]
    fn cancellation_interrupts_hashing_and_planning() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("file"), b"data").unwrap();
        let control = SyncControl::new();
        control.cancel();
        assert!(matches!(
            sha1_reader(
                std::fs::File::open(temp.path().join("file")).unwrap(),
                &control
            ),
            Err(RepositoryError::Cancelled)
        ));
        let root = Directory::open(temp.path()).unwrap();
        let manifest = SyncManifest {
            summary: ManifestSummary {
                directories: 1,
                files: 1,
                total_bytes: 4,
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 0,
            },
            entries: vec![entry("file", b"data")],
        };
        assert!(matches!(
            build_sync_plan_controlled(
                &manifest,
                &["@Test".into()],
                &root,
                true,
                &control,
                &|_| {}
            ),
            Err(RepositoryError::Cancelled)
        ));
    }

    #[test]
    fn install_journal_recovers_after_partial_commit_and_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let root = Directory::open(temp.path()).unwrap();
        let first = entry("first", b"one");
        let second = entry("second", b"two");
        let pending = [&first, &second].map(|item| PendingFile {
            target: item.local_path.clone(),
            staged: staging_path(item),
            size: item.size,
            sha1: item.sha1.clone(),
        });
        root.write_atomic(&pending[0].staged, b"one").unwrap();
        root.write_atomic(&pending[1].staged, b"two").unwrap();
        root.write_atomic(Path::new(JOURNAL), &serde_json::to_vec(&pending).unwrap())
            .unwrap();
        // First rename commits; a directory at the second target prevents commit.
        root.directory(Path::new("@Test/second"), true).unwrap();
        assert!(recover_install(&root, &SyncControl::new()).is_err());
        assert_eq!(
            std::fs::read(temp.path().join("@Test/first")).unwrap(),
            b"one"
        );
        assert!(root.read(Path::new(JOURNAL)).is_ok());
        assert!(root.read(&pending[1].staged).is_ok());
        std::fs::remove_dir(temp.path().join("@Test/second")).unwrap();
        drop(root);
        let reopened = Directory::open(temp.path()).unwrap();
        recover_install(&reopened, &SyncControl::new()).unwrap();
        recover_install(&reopened, &SyncControl::new()).unwrap();
        assert_eq!(
            std::fs::read(temp.path().join("@Test/second")).unwrap(),
            b"two"
        );
        assert!(reopened.read(Path::new(JOURNAL)).is_err());
    }

    #[test]
    fn cancelled_install_retains_journal_and_verified_staging() {
        let temp = tempfile::tempdir().unwrap();
        let root = Directory::open(temp.path()).unwrap();
        let item = entry("file", b"data");
        let staged = staging_path(&item);
        root.write_atomic(&staged, b"data").unwrap();
        let pending = vec![PendingFile {
            target: item.local_path,
            staged: staged.clone(),
            size: item.size,
            sha1: item.sha1,
        }];
        root.write_atomic(Path::new(JOURNAL), &serde_json::to_vec(&pending).unwrap())
            .unwrap();
        let control = SyncControl::new();
        control.cancel();
        assert!(matches!(
            recover_install(&root, &control),
            Err(RepositoryError::Cancelled)
        ));
        assert!(root.read(&staged).is_ok());
        assert!(root.read(Path::new(JOURNAL)).is_ok());
        recover_install(&root, &SyncControl::new()).unwrap();
        assert_eq!(
            std::fs::read(temp.path().join("@Test/file")).unwrap(),
            b"data"
        );
    }

    #[test]
    fn verified_staging_is_reused_without_a_network_connection() {
        let temp = tempfile::tempdir().unwrap();
        let root = Directory::open(temp.path()).unwrap();
        let item = entry("file", b"data");
        root.write_atomic(&staging_path(&item), b"data").unwrap();
        let manifest = SyncManifest {
            summary: ManifestSummary {
                directories: 1,
                files: 1,
                total_bytes: 4,
                compressed_files: 0,
                addon_roots: 1,
                unhashed_files: 0,
            },
            entries: vec![item],
        };
        let plan = build_sync_plan_controlled(
            &manifest,
            &["@Test".into()],
            &root,
            false,
            &SyncControl::new(),
            &|_| {},
        )
        .unwrap();
        let endpoint = TransferEndpoint {
            protocol: TransferProtocol::Ftp,
            host: "invalid.invalid".into(),
            port: 0,
            login: String::new(),
            password: String::new(),
        };
        let result = download_and_install(
            &endpoint,
            &manifest,
            &plan,
            temp.path(),
            &root,
            &SyncControl::new(),
            &|_| {},
        )
        .unwrap();
        assert_eq!(result.downloaded_bytes, 0);
        assert_eq!(result.installed_files, 1);
        assert_eq!(
            std::fs::read(temp.path().join("@Test/file")).unwrap(),
            b"data"
        );
    }
}

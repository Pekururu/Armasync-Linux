//! Remembers what a file's SHA-1 was, so an unchanged file is not read twice.
//!
//! Checking a unit repository means hashing tens of gigabytes. A file whose
//! size and modification time are exactly what they were when it was last
//! hashed still has the hash it had then, so the check reuses that value
//! instead of reading the file again.
//!
//! This is a fast check, not proof that contents are unchanged. Full verification
//! bypasses this cache. During a fast check, the remembered hash is still compared
//! against the hash the repository publishes, on every check. What is skipped
//! is the reading, not the comparison. The assumption is only that a file
//! whose size and timestamp are untouched has untouched contents.

use crate::repository::filesystem::Directory;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Entries for files that have since been deleted are never pruned, so cap the
/// file rather than let a long-lived install grow it without limit.
const MAX_ENTRIES: usize = 200_000;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Stamp {
    pub size: u64,
    pub mtime_secs: i64,
    pub mtime_nanos: u32,
    pub sha1: String,
}

#[derive(Default, Deserialize, Serialize)]
pub struct Cache {
    #[serde(default)]
    files: HashMap<String, Stamp>,
    #[serde(skip)]
    dirty: bool,
}

/// The file's modification time, or `None` if the platform will not say. A file
/// without a usable timestamp is simply hashed every time.
pub fn modified_at(metadata: &fs::Metadata) -> Option<(i64, u32)> {
    let modified = metadata.modified().ok()?;
    match modified.duration_since(UNIX_EPOCH) {
        Ok(since) => Some((since.as_secs() as i64, since.subsec_nanos())),
        // Timestamps before 1970 are implausible here, but they must not panic.
        Err(error) => {
            let before = error.duration();
            Some((-(before.as_secs() as i64), before.subsec_nanos()))
        }
    }
}

impl Cache {
    pub fn load(destination: &Directory) -> Self {
        // A cache that cannot be read is not an error; it only means work.
        destination
            .read(Path::new(".armasync/verified-files.json"))
            .and_then(|mut file| {
                use std::io::Read;
                let mut text = String::new();
                file.by_ref()
                    .take(64 * 1024 * 1024)
                    .read_to_string(&mut text)?;
                Ok(text)
            })
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// The recorded hash for this file, if it has not changed since.
    pub fn hash_of(
        &self,
        relative_path: &str,
        size: u64,
        modified: Option<(i64, u32)>,
    ) -> Option<&str> {
        let (secs, nanos) = modified?;
        let stamp = self.files.get(relative_path)?;
        (stamp.size == size && stamp.mtime_secs == secs && stamp.mtime_nanos == nanos)
            .then_some(stamp.sha1.as_str())
    }

    pub fn remember(
        &mut self,
        relative_path: &str,
        size: u64,
        modified: Option<(i64, u32)>,
        sha1: String,
    ) {
        let Some((mtime_secs, mtime_nanos)) = modified else {
            return;
        };
        if self.files.len() >= MAX_ENTRIES && !self.files.contains_key(relative_path) {
            return;
        }
        self.files.insert(
            relative_path.to_owned(),
            Stamp {
                size,
                mtime_secs,
                mtime_nanos,
                sha1,
            },
        );
        self.dirty = true;
    }

    pub fn save(&self, destination: &Directory) {
        if !self.dirty {
            return;
        }
        let Ok(encoded) = serde_json::to_vec(self) else {
            return;
        };
        let _ = destination.write_atomic(Path::new(".armasync/verified-files.json"), &encoded);
    }
}

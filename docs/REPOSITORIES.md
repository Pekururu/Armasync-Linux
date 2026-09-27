# Repository workflow

The Repos screen deliberately preserves the useful Arma3Sync sequence without
copying its crowded nested-tab layout:

1. Add a public `.a3s/autoconfig` URL and select or create an addon destination.
   The dialog inspects the auto-config before anything is saved and shows the
   repository name, mod count, size, transfer protocol, and the free space left
   at the destination after download.
2. **Add And Download** saves the repository, reads its manifest, checks every
   addon, and synchronizes what is missing.
3. Opening a saved repository reads the current `.a3s/sync` manifest and
   `.a3s/events` modsets. Nothing is downloaded in this step.
4. Select all addons or one published modset. Individual addons can be chosen
   under **Choose Mods To Sync**.
5. Create a linked addon group, or update the group previously linked to that modset.
6. Check local files explicitly with **Check Now** or **Check Again**, with live
   progress while hashing.
7. Review **What changed**: every selected addon that is new, changed, or
   couldn't be matched, with file counts and transfer size.
8. Synchronize explicitly with **Sync N Changes**. There is no confirmation
   dialog: what changes and how much is transferred are already on screen, and
   a transfer can be paused or stopped while it runs.

Checking reports its phase, file counts, and the addon being verified through a
Tauri channel, on a 120 ms timer — a repository can hold a hundred thousand
files, so it does not report per file. Each checked addon is then marked up to
date, changed, new, or unresolved; only the ones that need work are listed under
What changed.

Synchronization reports real transferred bytes, percentage, completed files,
and the current file through a Tauri channel. Transfer speed and remaining time
are derived in the interface from those totals, smoothed so the figure is
readable. Transfers can be paused, resumed,
or stopped. Verified downloads are retained for the next synchronization.
If installation stops halfway through, already installed files remain in place;
the next synchronization after restarting the app resumes the pending install
from its journal before planning new downloads. This is forward recovery, not
rollback. Do not launch the game until synchronization has finished.

Downloads use up to eight persistent FTP connections and schedule larger files
first. Progress is aggregated across those connections; every completed file is
still verified in staging before any installed file is replaced.

Saved repositories are listed on the left with their status. The selected
repository fills the right side, so switching repositories does not create
nested tabs.

Check results are shared with the rest of the app. Play lists each repository's
state and, when a repository feeding the active addon group has changes, offers
**Update And Launch**: it synchronizes those repositories, then starts Arma. The
launch dock shows how many updates are pending. Nothing is checked or downloaded
in the background.

## Compatibility

The current implementation reads the real gzip-compressed Java serialization
format used by Arma3Sync for `AutoConfig`, `SyncTreeDirectory`, and `Events`.
It supports FTP and HTTPS transfers advertised by the repository's auto-config. Unsupported protocol variants fail closed with a clear error.

Repository event/modset addon membership is supported. Event data is not treated
as launch order because Arma3Sync serializes that membership as a Java `HashMap`,
which has no semantic order. The Mods screen remains the authority for launch
order. A new linked group uses deterministic repository display order. Updating a
linked group preserves the manual order of retained members, removes addons no
longer published, and appends newly published members.

## File safety

- Auto-config URLs accept HTTP or HTTPS; prefer HTTPS.
- URLs containing embedded credentials are rejected before being saved.
- FTP credentials found inside the downloaded auto-config remain in memory only.
- Remote path components are validated against traversal and absolute paths.
- Repository file reads and writes use directory descriptors and reject symlinks
  in addon and state paths. Choose a physical addon directory as the destination.
- A destination file lock prevents simultaneous checks or syncs across app instances.
- File checks compare expected size and SHA-1 when the manifest provides one.
- Hashing runs across up to eight threads; beyond that read bandwidth, not the
  CPU, is the limit.
- A file's SHA-1 is remembered in `<destination>/.armasync/verified-files.json`
  against its size and modification time, so an untouched file is not read
  again on the next check. The remembered hash is still compared against the
  repository's on every check — only the reading is skipped. Touch a file, and
  it is hashed again. **Full Verification**, in the repository's ⋯ menu, reads
  and hashes every selected file, bypassing the cache, including files whose
  timestamps were preserved. Ordinary checks trust size and modification time;
  they cannot detect every content change.
- Checks can be stopped, and synchronization can be stopped while hashing.
  An outstanding network read may need to finish or time out first.
- Downloads are staged on the destination filesystem and verified before install.
- On HTTPS repositories, a changed file of 1 MiB or more is patched rather than
  downloaded whole. Arma3Sync writes a `.zsync` file next to every file of an
  HTTP repository. Armasync reads it, reuses every block the local copy already
  has, even where the change shifted it, and fetches only the rest with HTTP
  range requests. The rebuilt file is SHA-1 checked like any other download.
  When the `.zsync` file is missing or stale, the server ignores ranges, or the
  check fails, that file downloads whole instead. FTP repositories have no
  `.zsync` files and always download whole files.
- Replaced files are not backed up. The repository is the source of truth, so
  any file it replaced can be fetched again by checking and synchronizing.
- An interrupted installation leaves the files it already installed in place.
  A durable `.armasync/install.json` journal tracks the pending files. Completed
  staging files are hashed again before recovery, and renames can safely be
  replayed after a crash. The journal is removed only after all installs finish.
  Retained staging consumes disk space until it is installed; partial transfers
  restart at the beginning of that file on retry.
- Repository removal only removes launcher configuration; addon files remain.
- Repository-declared deletions and untracked local-file deletion are not enabled.

Repository destinations are not automatically added as addon search directories.
This keeps the explicit-source behavior of the Mods screen. Choose an existing
source as the destination, or add the destination manually under Mods → Sources.
While the repository is saved, that source is locked in the Sources sheet.
**Change Download Folder**, in the repository's ⋯ menu, accepts an existing
directory from the native picker or a new absolute path, which is created when
the setting is saved.

## Next protocol/UI work

- Add SFTP transfer support if real repositories require it.
- Surface repository update notifications without background auto-downloads.

# Repository workflow

The repository tab deliberately preserves the useful Arma3Sync sequence without
copying its crowded nested-tab layout:

1. Add a public `.a3s/autoconfig` HTTPS URL and select or create an addon destination.
2. Import and validate the auto-config before saving it.
3. Connect to retrieve the current `.a3s/sync` manifest and `.a3s/events` modsets.
4. Select all addons or one published modset.
5. Create a linked addon group, or update the group previously linked to that modset.
6. Check local files explicitly.
7. Review verified, missing, and replacement counts.
8. Synchronize explicitly after a native confirmation dialog.

Synchronization reports real transferred bytes, percentage, completed files,
and the current file through a Tauri channel. Transfers can be paused, resumed,
or stopped; stopping removes staged partial data and rolls back an interrupted
install.

Downloads use up to eight persistent FTP connections and schedule larger files
first. Progress is aggregated across those connections; every completed file is
still verified in staging before any installed file is replaced.

Saved repositories stay in the left rail. The connected repository occupies the
right working area, so switching repositories does not create additional nested
tabs.

## Compatibility

The current implementation reads the real gzip-compressed Java serialization
format used by Arma3Sync for `AutoConfig`, `SyncTreeDirectory`, and `Events`.
It currently supports the FTP transfer protocol advertised by the repository's
auto-config. Unsupported protocol variants fail closed with a clear error.

Repository event/modset addon membership is supported. Event data is not treated
as launch order because Arma3Sync serializes that membership as a Java `HashMap`,
which has no semantic order. The Addons tab remains the authority for launch
order. A new linked group uses deterministic repository display order. Updating a
linked group preserves the manual order of retained members, removes addons no
longer published, and appends newly published members.

## File safety

- Auto-config URLs must use HTTPS.
- URLs containing embedded credentials are rejected before being saved.
- FTP credentials found inside the downloaded auto-config remain in memory only.
- Remote path components are validated against traversal and absolute paths.
- File checks compare expected size and SHA-1 when the manifest provides one.
- Downloads are staged on the destination filesystem and verified before install.
- Replaced files are backed up beneath `<destination>/.armasync/backups/`.
- An interrupted installation rolls back files already changed by that run.
- Repository removal only removes launcher configuration; addon files remain.
- Repository-declared deletions and untracked local-file deletion are not enabled.

Repository destinations are not automatically added as addon search directories.
This keeps the explicit-source behavior of the Addons tab. Choose an existing
source as the destination, or add the destination manually under Addons → Sources.
The destination editor accepts an existing directory from the native picker or a
new absolute path, which is created when the setting is saved.

## Next protocol/UI work

- Add authenticated HTTPS/SFTP transfer variants if real repositories require them.
- Surface repository update notifications without background auto-downloads.

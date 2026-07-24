# TeamSpeak 3 and ACRE2

ACRE2 uses a TeamSpeak 3 plugin. The launcher therefore installs the official
Windows x64 TeamSpeak 3.6.2 client inside Arma 3's Proton prefix (`107410`) and
always launches that copy with `protontricks-launch --appid 107410`.

The tab presents three explicit stages:

1. Verify the prefix and install the recommended Winetricks runtime components.
2. Download and start the official TeamSpeak installer in the shared prefix.
3. Locate CBA_A3 and ACRE2 across configured addon sources and install ACRE's
   64-bit TeamSpeak plugin.

TeamSpeak should be installed for all users at its default Windows path. After
first launch, disable `Gamepad and Joystick Hotkey Support`, enable the ACRE2
plugin, and verify the displayed PipeWire input/output devices.

## Optional dark style

The launcher includes its own color-only TeamSpeak style, `Armasync Dark`.
Installing it writes a QSS file to the Proton user's `%APPDATA%\TS3Client\styles`
folder. It contains no executable plugin code and does not replace TeamSpeak
icons or other assets. Select it once under TeamSpeak's Tools → Options → Design.

The style is opt-in. Removing it renames the launcher-owned QSS to a timestamped
recovery copy rather than deleting unrelated TeamSpeak configuration.

## Safety and diagnostics

- Prefix changes require confirmation and create timestamped `.tar.zst` backups
  beside the compatdata directory under `.armasync-backups`.
- Runtime verbs execute separately and their complete output is retained.
- The TeamSpeak installer is fetched only from TeamSpeak's HTTPS release host,
  size-limited, and checked for a Windows PE signature before execution.
- TeamSpeak launch and installer output is retained under
  `~/.local/state/armasync/logs/`.
- An existing ACRE plugin is copied to a timestamped backup before replacement.
- Plugin replacement is refused while TeamSpeak is running.
- `mfc140` is intentionally not part of normal setup. It should only be added if
  an ACRE extension error specifically reports the missing MFC/VC140 runtime.

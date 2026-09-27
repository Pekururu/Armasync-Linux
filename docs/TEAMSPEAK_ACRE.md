# TeamSpeak 3 and ACRE2

ACRE2 uses a TeamSpeak 3 plugin. The launcher therefore installs the official
Windows x64 TeamSpeak 3.6.2 client inside Arma 3's Proton prefix (`107410`) and
always launches that copy with `protontricks-launch --appid 107410`.

The Voice screen is one ordered checklist with a progress bar. Finished steps
collapse to a row, only the current step is open with its action, and later
steps are dimmed:

1. **Prepare Proton prefix.** Check that the prefix exists (Arma must have run
   once) and install the recommended Winetricks runtime components.
2. **Radio mod and CBA_A3.** Find ACRE2 or TFAR, and CBA_A3, across the
   configured addon sources.
3. **Install TeamSpeak 3.6.2.** Download and start the official installer in
   the shared prefix.
4. **One-time TeamSpeak settings.** The radio mod installs its own 64-bit
   TeamSpeak plugin the first time Arma runs with it; this step is done once
   that plugin is in place and voice is ready.

TeamSpeak should be installed for all users at its default Windows path. After
first launch, disable `Gamepad and Joystick Hotkey Support`, enable the ACRE2 or
TFAR plugin, and check that TeamSpeak picked the right microphone and speakers.

Whether TeamSpeak is running is shown beside the Voice title. **Start
TeamSpeak** is offered there and on Play once voice is set up.

## Optional dark style

The launcher includes its own color-only TeamSpeak style, `Armasync Dark`.
Installing it writes a QSS file to the Proton user's `%APPDATA%\TS3Client\styles`
folder. It contains no executable plugin code and does not replace TeamSpeak
icons or other assets. It is an optional switch at the bottom of the Voice
screen. Select it once under TeamSpeak's Tools → Options → Design.

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
- `mfc140` is intentionally not part of normal setup. It should only be added if
  an ACRE extension error specifically reports the missing MFC/VC140 runtime.

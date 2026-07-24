# Troubleshooting record

## WebKitGTK exits with Wayland protocol error on NVIDIA

Observed during `pnpm tauri dev`:

```text
Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display.
[vite] Pre-transform error: The service was stopped: write EPIPE
```

The GDK/Wayland error is the primary failure. The Vite/esbuild `EPIPE` is a
secondary consequence of the native Tauri process and its development command
being torn down.

On this NVIDIA/Wayland system, WebKitGTK's DMA-BUF renderer can trigger the
protocol failure. At Linux startup, before GTK or WebKit is initialized, the
launcher now sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` when the NVIDIA kernel
driver is present. This retains the native Wayland backend and disables only
the problematic WebKit buffer-import path.

The workaround is implemented in `src-tauri/src/lib.rs`. A native development
startup test remained healthy after the change.

## Protontricks exited with status 1 during voice setup

The earlier launcher attempted to install all of these verbs in one command:

```text
d3dcompiler_43 d3dx10_43 d3dx11_43 xact_x64 xaudio29
```

It returned status code 1 without retaining stdout/stderr, so the failed verb and
actual Winetricks error could not be recovered. A subsequent read-only inspection
found:

- Protontricks 1.14.1 detects Arma 3 and its `/mnt/Games` prefix correctly.
- The selected compatibility tool is `GE-Proton11-1`.
- Protontricks reports Wine 11's new WoW64 mode as experimental.
- It also warns that the current Steam Runtime is not recognized.
- All five verb names are valid, but `pfx/winetricks.log` did not exist, meaning
  the failed attempt did not complete installation of any verb.

These warnings are diagnostic context, not a proven root cause. The new TeamSpeak
tab backs up the prefix once, runs each component separately, stops on the first
failure, and saves complete output to
`~/.local/state/armalauncher/logs/voice-runtime.log`. This turns another status-1
failure into an actionable component name and log rather than guessing.

## Compatibility setup rejected `-q`

Protontricks 1.14.1 reported `unrecognized arguments: -q` because the launcher
placed the Winetricks quiet flag before Arma's app ID. Protontricks parses options
before the app ID as its own; arguments after the app ID are forwarded to
Winetricks. Runtime and optional MFC repair commands now use
`protontricks 107410 -q <verb>`.

## Repository synchronization was much slower than Arma3Sync

The first native downloader reused one FTP session but transferred every file
serially and called a forced disk sync after each file. This underused both the
network and storage, especially for repositories containing many small files.

Synchronization now uses a bounded pool of up to eight persistent FTP
connections, schedules larger files first, and relies on normal buffered writes
before SHA-1 verification. Pause, stop, staging, verification, backups, and
installation rollback still apply across the worker pool.

## Launch selectors and TeamSpeak status appeared stale

Configuration managers originally notified the shared launch bar only after a
full save, so newly applied profile and server drafts were absent from its
selectors. The selectors now reflect drafts immediately, while game launch is
disabled until those changes are saved so frontend and backend configuration
cannot disagree.

The ACRE tab also originally checked TeamSpeak only when opened or manually
refreshed. While visible, it now performs a lightweight process check every 1.5
seconds and silently refreshes full voice state when the launcher regains focus.

## Distinct repository mods disappeared from Addons

`@LT_Moderne`, `@LT_Moderne_Terrein`, and `@LT_Mods_Terrein` are distinct local
mods but all declare `publishedid = 424190840` in their metadata. Addon discovery
originally treated that field as a global identity, so the first folder hid the
other two. Workshop-ID deduplication now applies only to actual Steam Workshop
sources. Repository and other local mods use their canonical paths as identity.

This was unrelated to the nested optional-addon boundary used to prevent
`@ace_nomedical` inside `@LT_Ace` from becoming a separate addon.

## Managed profiles and servers disappeared after restart

The profile and server editors originally treated their nested **Apply** actions
as in-memory changes that still required the page-level **Save changes** action.
Because the launch selectors reflected those drafts immediately, the entries
looked committed even though no `launcher.toml` had been written.

Profile and server Apply, Edit, and Remove actions now persist immediately. The
page-level save remains for general launch-option changes. A failed managed-item
write stays visible as an unsaved draft and reports the storage error.

## Launch reported success but Arma never started

Proton initialized, but no new Arma RPT was created because the launcher invoked
`arma3_x64.exe` with its own release directory as the working directory. Steam's
successful flow changes into the Arma installation directory first, which the
game needs to locate adjacent runtime files and data.

Game launch now sets the Arma installation as the child working directory. It
also observes the Protontricks process during initial startup and reports an
early exit with the diagnostic log path instead of immediately claiming success.

## Troubleshooting workspace

The in-app Troubleshooting tab provides read-only checks for Arma, its Proton
environment, Protontricks, Vulkan, PipeWire, the selected Proton version, addon
sources, TeamSpeak/ACRE, free storage, and the NVIDIA/WebKit workaround.

It also exposes quick links to the game, compatibility files, Arma profiles, and
launcher logs; the newest Arma RPT; and an inventory of launcher-created prefix
backups. Backups are never removed automatically.

Support bundles are written to `~/Downloads` when available. They contain the
diagnostic report, recent launcher logs, the newest RPT, and launcher settings.
Repository credentials and TeamSpeak identity data are not collected.

The MFC/VC140 action remains behind Advanced maintenance and an explicit warning.
It creates a prefix restore point and should only be used when an ACRE extension
error specifically reports that missing runtime.

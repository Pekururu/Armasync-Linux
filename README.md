# Armasync

A native Linux Arma3Sync replacement for Arma 3 unit play, retaining the
familiar tab-based workflow while integrating Steam/Proton launching and ACRE.

Armasync includes addon discovery and ordered groups, Arma3Sync-compatible
repository synchronization with live progress and transfer controls, player and
server configuration, Windows TeamSpeak 3 radio setup (ACRE2 and TFAR), and
troubleshooting tools.

## Requirements

The GUI libraries (WebKitGTK 4.1, GTK 3) are declared as package dependencies
and installed automatically with the deb/rpm/AUR packages.

Host tools Armasync uses at runtime — install these from your distribution:

**To play:**

- **Steam** with **Arma 3** installed and a **Proton** compatibility tool
  enabled for it.

**For TeamSpeak voice — ACRE2 and/or TFAR (optional):**

- **protontricks** (provides `protontricks` and `protontricks-launch`).
  Install the distro package or `pipx install protontricks` — the Flatpak
  build is not sufficient, since Armasync needs both binaries on `PATH`.
- **PipeWire** with **WirePlumber** (`wpctl`) and **pipewire-pulse** —
  the default audio stack on current Fedora, Ubuntu, and Arch installs.

**For restore points and support bundles (optional):**

- **tar** and **zstd** (present by default on nearly every distribution).

Armasync checks for these at startup and shows what's missing and how to
install it; the Troubleshooting tab runs the same checks on demand.

## Planned

- **Swifty repository support** — a second manifest adapter for Swifty's
  `repo.json`/`.srf` format, reusing the existing verify/download engine.
  Arma3Sync-compatible repositories are fully supported today.

## Development

```sh
pnpm install
pnpm tauri dev
```

For a browser-only UI preview, run `pnpm dev`.

Build the optimized native executable with `pnpm tauri build`.

Development issues and machine-specific workarounds are recorded in
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

Selectable DLC handles and Steam detection rules are documented in
[`docs/DLC_DETECTION.md`](docs/DLC_DETECTION.md).

Addon directory persistence, priority, and bounded scan behavior are described
in [`docs/ADDON_SOURCES.md`](docs/ADDON_SOURCES.md).

# Armasync

A native Linux Arma3Sync replacement for Arma 3 unit play, retaining the
familiar tab-based workflow while integrating Steam/Proton launching and ACRE.

Version 0.2.5 includes addon discovery and ordered groups, Arma3Sync-compatible
repository synchronization with live progress and transfer controls, player and
server configuration, Windows TeamSpeak 3/ACRE setup, and troubleshooting tools.

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

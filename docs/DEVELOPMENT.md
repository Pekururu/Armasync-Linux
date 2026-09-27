# Development

## Run it

```sh
pnpm install
pnpm tauri dev
```

Run `pnpm dev` for a preview of the interface in the browser, without the
backend. Build the optimised native app with `pnpm tauri build`.

The interface uses [KalmUI](../src/kalmui/). Its files are copied in unchanged,
so don't edit them. Colours, spacing and type come from its tokens.

## How things work

These pages explain how things work, and why:

- [`REPOSITORIES.md`](REPOSITORIES.md): the repository workflow,
  compatibility and file safety.
- [`ADDON_SOURCES.md`](ADDON_SOURCES.md): addon folders, priority and
  what a scan looks at.
- [`DLC_DETECTION.md`](DLC_DETECTION.md): DLC handles and Steam
  detection.
- [`LAUNCHER_OPTIONS.md`](LAUNCHER_OPTIONS.md): launch settings,
  profiles and servers.
- [`TEAMSPEAK_ACRE.md`](TEAMSPEAK_ACRE.md): TeamSpeak and radio
  setup under Proton.
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md): problems we've hit and
  how they were fixed.

## Checks

CI runs these on every push to `main` and on pull requests. Run them before you
commit.

```sh
pnpm version:check
pnpm typecheck
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Rust models generate `src/bindings.ts`. After changing an IPC model, run
`pnpm bindings`; the tests reject stale bindings. Keep interface-only types in
the frontend.

## Versions and releases

`package.json` owns the release version. After bumping it, run
`pnpm version:sync` and commit the updated Cargo manifest, lockfile and Tauri
config. CI and release builds check that all versions agree.

Releases run every Tuesday at 18:00 Europe/Amsterdam, or by hand through the
Release workflow on `main`. GitHub may run the scheduled one a little late. If
nothing was committed since the latest stable release, the build and AUR
publication are skipped. An unreleased version in `package.json` is kept.
Otherwise the workflow bumps the patch version, syncs the manifests and commits
the bump to `main` before building that exact commit, so the workflow token
needs permission to push to `main`. A failed build can be retried by hand. AUR
publication runs only after a successful release, and only when the AUR
credentials are set.

## Code layout

Repository code lives in `src-tauri/src/repository/`. `decoding` reads the wire
format, `transport` handles network I/O within limits, `planning` checks local
files, `installation` handles staging and recovery, and `filesystem` keeps disk
access inside the destination. Compatibility tests use reproducible synthetic
fixtures in `src-tauri/tests/fixtures`.

Settings storage shares durable writes and file locks in `persistence.rs`.
Settings live in `$XDG_CONFIG_HOME/armasync` (or `~/.config/armasync`). Files in
the old default location stay readable until settings are saved to the new
one. Relative XDG paths are ignored.

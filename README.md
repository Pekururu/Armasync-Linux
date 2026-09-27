<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo/logo-white.svg">
  <img src="docs/logo/logo-dark.svg" align="right" alt="" width="72">
</picture>

# Armasync

Still booting Windows because your unit runs Arma3Sync? You don't have to.

Armasync reads your unit's Arma3Sync repository, over FTP or HTTP(S), downloads
the mods and keeps them up to date. It sets up TeamSpeak radio (ACRE2 or TFAR)
inside Proton and starts Arma through Steam with your mods in the right order.
Your unit keeps its repository. You keep Linux.

![Armasync's Play, Repos and Mods screens](docs/screenshots/preview.png)

## Install

**Arch Linux (and derivatives like CachyOS, EndeavourOS, Manjaro):**

```sh
yay -S armasync-bin
```

**Debian / Ubuntu:** download the `.deb` from the
[latest release](https://github.com/Pekururu/Armasync-Linux/releases/latest),
then:

```sh
sudo apt install ./Armasync_*_amd64.deb
```

**Fedora:** download the `.rpm` from the
[latest release](https://github.com/Pekururu/Armasync-Linux/releases/latest),
then:

```sh
sudo dnf install ./Armasync-*.x86_64.rpm
```

**Other distributions:** download the `.AppImage` from the
[latest release](https://github.com/Pekururu/Armasync-Linux/releases/latest),
make it executable (`chmod +x`) and run it.

## What you need

The packages install the interface libraries (WebKitGTK 4.1, GTK 3) for you.
Install the rest from your distribution.

**To play:**

- **Steam** with **Arma 3** installed and a **Proton** version turned on for it
  (Steam → Arma 3 → Properties → Compatibility).

**For TeamSpeak radio (optional):**

- **protontricks**, which provides `protontricks` and `protontricks-launch`.
  Use the distribution package or `pipx install protontricks`. The Flatpak
  version isn't enough, because Armasync needs both commands on `PATH`.
- **PipeWire** with **WirePlumber** (`wpctl`) and **pipewire-pulse**. Current
  Fedora, Ubuntu and Arch installs have these already.

**For restore points and support bundles (optional):**

- **tar** and **zstd**. Nearly every distribution has these already.

Armasync checks for all of this. The Health screen shows what's missing and
how to install it.

## Getting started

Do this once. It takes about ten minutes, plus the time your unit's mods take
to download.

1. **Run Arma 3 once from Steam.** This makes Proton create the folder Armasync
   works in. Quit at the main menu.
2. **Add your mod folders.** Open **Mods**, then **Sources**, and press
   **Add Folder** for each folder that holds `@mod` folders. Add
   **Steam Workshop** from the same list if you use it. Armasync only reads
   these folders. Removing one never deletes files.
3. **Add your unit's repository.** Ask your unit for their autoconfig link.
   It's the same one Arma3Sync uses and ends in `/.a3s/autoconfig`. Open
   **Repos**, press **+** and paste it. Armasync checks the link before saving
   and shows what you're adding. Pick a download folder and press
   **Add And Download**.
4. **Make an addon group.** An addon group is the list of mods Arma starts
   with, in load order. If your unit publishes modsets, pick one on the
   repository and press **Create Addon Group**. Otherwise build one in **Mods**
   by dragging addons from the left into the group on the right.
5. **Set up voice.** Open **Voice** and follow the checklist. Each step says
   what it does and has one button. When TeamSpeak's installer opens, choose
   **Install for all users** and keep the default folder.
6. **Add your profile and server.** In **Launch**, add the player name you use
   and your unit's server. The server password is stored on this computer only.

## Game day

Open Armasync. **Play** shows whether you're ready and what's in the way, each
with a button to fix it.

1. Press **Check** next to your repository. If your unit changed mods,
   Play says so.
2. Start TeamSpeak from Play or Voice and join your unit's TeamSpeak server.
3. Check the addon group, server and profile, then press **Launch**. If there's
   an update, press **Update And Launch** to download it first.

The game's own launcher is skipped. Armasync starts Arma through Proton with
your mods in the order of the group.

## The screens

| Screen | What it's for |
| --- | --- |
| **Play** | Whether you're ready, and the Launch button |
| **Mods** | Your installed addons and the groups you launch with |
| **Repos** | Your unit's repositories: check, see what changed, sync |
| **Voice** | TeamSpeak and radio setup, one step at a time |
| **Launch** | Startup options, profiles, servers and the launch command |
| **Health** | Checks, folders, logs and repairs |

Every screen except Play has the launch dock at the bottom: what you'll launch
with, and **Launch**. Settings save automatically.

## When something goes wrong

Open **Health**. Problems come first, each with what's wrong and how to fix it.
Passed checks fold away.

- **Mods missing in game.** Check the addon group in the dock. Then open
  **Repos** and press **Check Again**. Anything missing shows under
  What changed.
- **No radio in TeamSpeak.** Start TeamSpeak from Armasync, not from your
  desktop, and make sure the radio plugin is on under Tools → Options → Addons.
- **ACRE reports a missing MFC or VC140 runtime.** Only then, use
  **ACRE MFC/VC140 repair** in Health. It makes a restore point first.

Asking for help? Press **Support Bundle** in Health. It saves the checks, recent
logs, the newest Arma log and your launch settings to your Downloads folder in
one file. Server passwords are blanked out, and repository logins and your
TeamSpeak identity aren't included.

## Planned

- **Swifty repositories.** A second reader for Swifty's `repo.json`/`.srf`
  format, reusing the same check and download engine. Arma3Sync repositories
  are fully supported today.

## Development

```sh
pnpm install
pnpm tauri dev
```

Run `pnpm dev` for a preview of the interface in the browser, without the
backend. Build the optimised native app with `pnpm tauri build`.

The interface uses [KalmUI](src/kalmui/). Its files are copied in unchanged, so
don't edit them. Colours, spacing and type come from its tokens.

How things work, and why:

- [`docs/REPOSITORIES.md`](docs/REPOSITORIES.md): the repository workflow,
  compatibility and file safety.
- [`docs/ADDON_SOURCES.md`](docs/ADDON_SOURCES.md): addon folders, priority and
  what a scan looks at.
- [`docs/DLC_DETECTION.md`](docs/DLC_DETECTION.md): DLC handles and Steam
  detection.
- [`docs/LAUNCHER_OPTIONS.md`](docs/LAUNCHER_OPTIONS.md): launch settings,
  profiles and servers.
- [`docs/TEAMSPEAK_ACRE.md`](docs/TEAMSPEAK_ACRE.md): TeamSpeak and radio
  setup under Proton.
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md): problems we've hit and
  how they were fixed.

## Development checks

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

Repository code lives in `src-tauri/src/repository/`. `decoding` reads the wire
format, `transport` handles network I/O within limits, `planning` checks local
files, `installation` handles staging and recovery, and `filesystem` keeps disk
access inside the destination. Compatibility tests use reproducible synthetic
fixtures in `src-tauri/tests/fixtures`.

Settings storage shares durable writes and file locks in `persistence.rs`.
Settings live in `$XDG_CONFIG_HOME/armasync` (or `~/.config/armasync`). Files in
the old default location stay readable until settings are saved to the new
one. Relative XDG paths are ignored.

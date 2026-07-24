# Native Linux Packaging Roadmap (moving off AppImage-only)

## Context

`armalauncher` (the working prototype at `/home/pek/Projects/armalauncher/`) currently ships **only** as an AppImage (`src-tauri/tauri.conf.json` → `bundle.targets: ["appimage"]`). AppImages are broadly disliked in the Linux community (no auto-updates via package manager, FUSE friction, "why isn't this in my repo" complaints), so the goal for this project (`arma-sync-linux`) is to move toward genuinely native packages per distro, starting with **Arch Linux** (the dev's own distro, CachyOS), then Debian/Ubuntu and Fedora.

Decisions made so far:
- **License: GPL-3.0** (needed for `Cargo.toml`/`tauri.conf.json` license fields, the AUR `PKGBUILD license=()` array, and deb/rpm control-file metadata).
- **GitHub remote: deferred.** No repo/remote exists yet for this new project. Everything below that depends on a public GitHub repo (CI artifact hosting, GitHub Releases, AUR `-bin` source URL) is blocked until that's set up — flagged explicitly per phase below.

Key facts carried over from `armalauncher` (the prototype to copy from):
- Its `src-tauri/tauri.conf.json` bundle section has no `category`, `license`, `homepage`, or `publisher` fields set; icons exist but no deb/rpm sub-config.
- No `LICENSE` file, no `license` field in `Cargo.toml`.
- No `.github/workflows/` — zero CI/CD exists.
- Dev machine is CachyOS (rolling release, bleeding-edge glibc/binutils) — this **already broke AppImage bundling once** on the prototype (a `.relr.dyn` strip incompatibility in Tauri's cached `linuxdeploy`, worked around by patching the machine-wide tool cache). This means local builds on this machine are **not safe** for producing portable release artifacts long-term; an old-baseline build environment (CI container or local Docker) is required, not optional.
- Persistence code in the prototype (`launch_selection.rs`, `addon_groups.rs`, `launcher_options.rs`, `repository_store.rs`, `diagnostics.rs`, `game_launch.rs`, `voice.rs`) already reads `XDG_CONFIG_HOME`/`$HOME/.config`, `$HOME/.local/state`, `$HOME/.cache` correctly — this pattern should just be copied as-is, **no rework needed** for cross-distro path portability.
- Tauri v2's bundler natively supports `deb` and `rpm` targets (just add to `bundle.targets` + `bundle.linux.deb`/`bundle.linux.rpm` config) — the hard part isn't the packaging format, it's build-environment portability and, for Arch, the fact Tauri has **no built-in Arch target at all** (Arch packaging always goes through a hand-written PKGBUILD submitted to the AUR).

## Phase A0 — Repo hygiene (prerequisite for everything else)

- Add `LICENSE` file (GPL-3.0 full text).
- Set `license = "GPL-3.0-only"` in `src-tauri/Cargo.toml` (flows through to Tauri's bundle metadata automatically).
- In `src-tauri/tauri.conf.json` under `bundle`, add: `"category": "Game"`, `"homepage"`, `"publisher"` (avoids Tauri defaulting the Debian `Maintainer` field to the identifier's org/user segment), and optionally `shortDescription`/`longDescription`.
- **Blocked on the deferred GitHub decision**: `homepage` and any release-artifact URLs (used later by AUR `source=` and CI) can't be finalized until a repo exists. Placeholder values can be used now if you want the config changes applied before that decision is made.

**Effort: S.**

## Phase A1 — Enable deb/rpm bundle targets

- Set `bundle.targets` to `["appimage", "deb", "rpm"]`.
- Add `bundle.linux.deb`: `depends: ["libwebkit2gtk-4.1-0", "libgtk-3-0"]`, `section: "games"`, `priority: "optional"`.
- Add `bundle.linux.rpm`: `depends: ["webkit2gtk4.1", "gtk3"]` (verify exact Fedora package names against a real Fedora build — RPM naming differs from Debian's), `release: "1"`.
- No new Rust dependencies implied beyond what the prototype already pulls in — everything (`reqwest`, `suppaftp`, `flate2`, `jaded`, `walkdir`, etc.) is pure-Rust/vendored, no extra system libs beyond Tauri's own GTK/WebKit stack.

**Effort: S.**

## Phase A2 — Portable build environment

Local builds on this CachyOS machine are unreliable for release artifacts (see the `.relr.dyn`/`linuxdeploy` incident on the prototype). Two complementary tracks:

1. **GitHub Actions CI** (primary, long-term correct answer) — `.github/workflows/release.yml`, triggered on tag push, building inside `ubuntu:22.04` (Tauri's own recommended old-baseline for glibc compatibility). Use `tauri-apps/tauri-action` to wrap `tauri build` and upload `appimage`/`deb`/`rpm` outputs as GitHub Release assets. **Requires the GitHub remote decision to be made first.**
2. **Local Docker/podman container** (secondary) — an `ubuntu:22.04`-based `Dockerfile.build` with the same dependency list, for cutting a release manually or reproducing CI issues without touching the fragile host toolchain. Document in a `docs/RELEASING.md`. This track works independently of the GitHub decision.

**Effort: M** (config is trivial; validating a clean CI/container build actually produces installable, dependency-correct deb/rpm on real Ubuntu/Fedora is the time sink).

## Phase B — Arch Linux / AUR (top priority)

**Recommendation: ship `armalauncher-bin` (binary package), not a from-source PKGBUILD.**

Why: this is a hobby-scale project with no CI yet. A source PKGBUILD needs `rust`, `cargo`, `nodejs`, `pnpm`, `webkit2gtk-4.1` etc. as `makedepends` and re-runs the entire build on every installer's machine — slow, and every future toolchain/registry hiccup becomes a package-breakage support burden. A `-bin` package instead downloads Phase A2's already-built `.deb` from a GitHub Release and re-extracts its payload (`bsdtar -xf data.tar.* -C "$pkgdir"`) — zero build tooling required, trivially kept in sync with each tagged release.

PKGBUILD shape:
- `pkgname=armalauncher-bin`, `pkgver` tracks `tauri.conf.json`/`Cargo.toml`'s version.
- `depends=(cairo desktop-file-utils gdk-pixbuf2 glib2 gtk3 hicolor-icon-theme libsoup pango webkit2gtk-4.1)` (Tauri's documented Arch runtime deps).
- `source=("https://github.com/<org>/armalauncher/releases/download/v${pkgver}/armalauncher_${pkgver}_amd64.deb")` + pinned `sha256sums`.
- `license=('GPL-3.0-only')`.
- `package()` just extracts the `.deb`'s `data.tar` — no re-authoring of desktop files/icons needed since Phase A0 already fixes `category`/metadata.

Submission workflow: create an AUR account + SSH key at aur.archlinux.org → `git clone ssh://aur@aur.archlinux.org/armalauncher-bin.git` → author `PKGBUILD` → `makepkg --printsrcinfo > .SRCINFO` → test with `makepkg -si` (safe to test on this machine — no compilation happens, only extraction) → commit + push. Per-release maintenance is a manual version/checksum bump (could be scripted/automated later against the GitHub Release webhook, but not needed for the initial submission).

**Blocked on**: Phase A2 existing (needs a real GitHub Release `.deb` to point `source=` at).

**Effort: S–M.**

## Phase C — Debian/Ubuntu and Fedora discoverability

Tauri already produces valid `.deb`/`.rpm` in Phase A1 — the remaining question is discoverability, not format:

- **Do immediately, low effort:** attach `.deb`/`.rpm` as GitHub Release assets (falls out of Phase A2's CI for free). Already satisfies "no AppImage" for anyone who finds the releases page.
- **Fedora COPR (recommended next step, worth doing):** lower friction than a Launchpad PPA — Fedora account + `copr-cli`, builds from a `.spec` + tarball, no separate GPG-signing ceremony for personal repos. Best discoverability-per-effort of the two options.
- **Ubuntu/Debian PPA (optional, defer):** meaningfully heavier — requires a parallel `debian/` source-package build path (`debuild`/`dput`) distinct from Tauri's bundler output, essentially a second packaging system to maintain. Not worth it at hobby scale unless there's real user demand once GitHub-download `.deb`s are available.

**Effort:** GitHub downloads = S, COPR = M, PPA = L (deferred).

## Sequencing

```
A0 (license, metadata)  →  A1 (deb/rpm targets)  →  A2 (CI / build container)
                                                          │
                                    ┌─────────────────────┼─────────────────────┐
                                    ▼                                           ▼
                     B (AUR -bin, top priority)                 C (GitHub downloads now;
                                                                   COPR next; PPA deferred)
```

A0→A1→A2 is a strict chain. B and C both need A2's artifacts but are otherwise independent and can proceed in parallel once A2 lands.

| Phase | Effort |
|---|---|
| A0 repo hygiene | S |
| A1 deb/rpm config | S |
| A2 CI + build container | M |
| B AUR (`-bin`) | S–M |
| C GitHub downloads | S |
| C COPR (optional) | M |
| C PPA (optional, deferred) | L |

## Immediate blocker

Everything past A0/A1 (real CI runs, tagged releases, AUR `source=` URLs) needs a **GitHub remote** for this new project — not yet set up. When ready, next step is: create/point to a GitHub repo, push, and this roadmap's A2/B/C phases become actionable.

## Verification (once phases are implemented)

- A1: run `pnpm tauri build` inside the Phase A2 container/CI and confirm `.deb`/`.rpm` appear under `src-tauri/target/release/bundle/{deb,rpm}/`; `dpkg -c` / `rpm -qlp` the outputs to sanity-check file layout and `Categories=`/dependency fields.
- A2: confirm a clean Ubuntu 22.04 container build reproduces the AppImage without the `.relr.dyn` strip failure seen on CachyOS (proves environment isolation actually fixes the fragility, not just moves it).
- B: `makepkg -si` the `armalauncher-bin` PKGBUILD locally, confirm the app launches from the AUR-installed path.
- C: `dpkg -i`/`rpm -i` the GitHub Release artifacts on a clean Debian/Fedora VM or container, confirm the app launches and desktop entry appears correctly categorized under "Games".

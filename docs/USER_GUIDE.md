# Armasync user guide

This guide walks you through everything from a fresh install to playing on
your unit's server with working radio. Follow it top to bottom the first
time; afterwards you'll mostly just press **Launch game**.

## Before you start

You need, installed from your distribution:

- **Steam** with **Arma 3** installed, and a **Proton** version enabled for
  it (Steam → Arma 3 → Properties → Compatibility).
- **protontricks** — only if you want TeamSpeak radio (ACRE2/TFAR).
- **PipeWire** with **WirePlumber** — the default audio stack on current
  distributions, so you probably already have it.

Armasync checks all of this at startup. If something is missing, the Addons
tab shows a **System setup** notice telling you what to install.

Install Armasync itself as described in the
[README](../README.md#installation).

## The window at a glance

Five tabs along the top:

| Tab | What it does |
| --- | --- |
| **Addons** | Your installed mods and the groups you launch with |
| **Repositories** | Download and update your unit's mods |
| **Voice** | Set up TeamSpeak with ACRE2 or TFAR radio |
| **Configuration** | Player profile, servers, display and startup options |
| **Troubleshooting** | Health checks, logs, and support bundles |

The bar at the bottom is always visible. It shows the addon group, server,
and profile you'll launch with, plus the **Launch game** button — and a
**TeamSpeak** button once TeamSpeak is installed.

## Addons

**Sources** tells Armasync where your mods live on disk. Open the Sources
drawer and add the folders that contain your `@mod` directories. Armasync
only ever reads these folders — removing a source never deletes files.

**Installed addons** lists everything found in your sources. Use the filter
box to search, and the source filter to show only Repository, Workshop, or
Local mods.

**Addon group** is the list of mods the game actually starts with, in load
order. Press **+** on an installed addon to add it to the current group,
**×** on a group row to remove it. You can create, rename, duplicate, and
delete groups — for example one group per unit or campaign. Groups save
automatically.

You usually don't build groups by hand: syncing a repository modset can
create and update a group for you (next section).

## Repositories

This is how you get your unit's mods. Ask your unit for their
**auto-config URL** (the same one used in Arma3Sync, ending in
`/.a3s/autoconfig`).

1. Press **Add repository**, paste the URL, and import it.
2. Choose a **download location** — the folder the mods will be stored in.
3. **Connect**. Armasync fetches the current addon list and any published
   modsets.
4. Pick **all addons** or a specific **modset**, then create an addon group
   from it (or update the group it created last time).
5. **Check files** — Armasync compares your disk against the repository and
   shows what's missing or changed.
6. **Synchronize** to download. You can **pause**, **resume**, or **stop**;
   stopping cleans up partial downloads and never leaves a broken install.

After syncing, the linked addon group is up to date and ready in the launch
bar. On patch day, connect → check files → synchronize is the whole routine.

Saved repositories stay in the left rail so reconnecting later is one click.

## Voice (TeamSpeak with ACRE2 / TFAR)

Arma units use radio mods — **ACRE2** or **TFAR** — that connect the game
to a Windows TeamSpeak 3 client. Armasync installs that client inside
Arma's own Proton prefix and wires the plugin up for you.

The **Get voice working** card has three steps, in order:

1. **Prepare compatibility** — installs the Windows components TeamSpeak
   needs into Arma's Proton prefix. A backup of the prefix is created
   first.
2. **Install TeamSpeak 3** — downloads the official TeamSpeak 3 installer
   and runs it. In the installer, keep the defaults (install for all
   users, default path).
3. **Connect radio plugin** — finds ACRE2 and/or TFAR among your installed
   addons and installs the matching TeamSpeak plugin. Both radios can be
   installed side by side; the mission's mods decide which one is active.

One-time TeamSpeak settings after the first start: disable **Gamepad and
Joystick Hotkey Support** when prompted, and check that the plugin is
enabled under Tools → Options → Addons.

Below the setup card you'll find your detected microphone and output
device, and **Armasync Dark** — an optional dark color theme for TeamSpeak.
Select it in TeamSpeak under Tools → Options → Design after installing.

On game day: press **TeamSpeak** in the bottom bar, connect to your unit's
TeamSpeak server, then press **Launch game**.

## Configuration

- **Display** — windowed, borderless, or leave it to Arma's own setting
  (recommended).
- **Startup** — skip splash screens and intro, and optional performance
  settings. The defaults are sensible; only change performance options if
  you know your hardware wants them.
- **Player profiles** — pick an existing Arma profile or add a new player
  name. The selected profile appears in the launch bar.
- **Server manager** — save your unit's server address, port, and password
  once; then pick it from the launch bar whenever you play.

Press **Save changes** when you're done — the launch button reminds you if
you forget.

## Launching the game

Check the bottom bar: the right **addon group**, **server**, and
**profile**. Start TeamSpeak first if you're using radio, then press
**Launch game**. Armasync starts Arma through Steam's Proton with your
mods in the right order — the game's own launcher is skipped.

If the button says **DLC required**, the group contains a DLC you don't
own; remove it from the group or get the DLC.

## When something goes wrong

Open the **Troubleshooting** tab:

- **Installation status** runs read-only checks on everything: Arma,
  Proton, protontricks, audio, addon sources, TeamSpeak, and disk space.
  Green means fine; anything else says what to fix.
- **Important folders** gives quick access to the game folder, Arma
  profiles, and launcher logs, plus the newest Arma crash report (RPT).
- **Compatibility backups** lists the prefix backups Armasync made before
  changing anything. They are never deleted automatically.
- A **support bundle** collects the diagnostic report and recent logs into
  a single archive in your Downloads folder — attach it when asking for
  help. It contains no passwords or TeamSpeak identities.

Common quick fixes:

- **Mods missing in-game** — check the launch bar showed the right group,
  and that the group's addons are all present (re-run Check files on the
  repository).
- **No radio in TeamSpeak** — make sure TeamSpeak was started from
  Armasync (bottom bar button), and that the plugin is enabled in
  TeamSpeak's Tools → Options → Addons.
- **ACRE reports a missing runtime** — only then, use the ACRE MFC/VC140
  repair under Advanced maintenance in Troubleshooting. It creates a
  restore point first.

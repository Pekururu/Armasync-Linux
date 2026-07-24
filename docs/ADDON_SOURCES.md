# Addon search directories

Addon search directories are configured from the **Sources** drawer on the
Addons tab. They are intentionally not a primary application tab: the folders
configure the installed-addon catalog rather than representing a separate
workflow.

## Explicit sources only

The native directory picker can add any accessible absolute directory. Paths
are canonicalized before storage, and aliases or symlinks resolving to an
already configured directory are rejected as duplicates. No mod directory is
added automatically. The game and Workshop directories appear only if the user
explicitly selects them.

Removing a source removes only its launcher configuration; it never deletes or
moves the directory or any files inside it. DLC discovery remains independent
and automatic because DLC comes from the detected Arma/Steam installation, not
from mod search directories.

Configuration is written atomically to:

```text
~/.config/armasync/config.toml
```

`XDG_CONFIG_HOME` is respected when present.

## Scan and priority behavior

Sources are ordered from highest to lowest priority and can be reordered by
dragging. This order is used when resolving duplicate addon identities: the
first matching addon wins.

Scanning is deliberately bounded:

- an explicitly selected game directory considers only direct `@...` children;
- an explicitly selected Workshop content directory considers direct mod roots;
- a custom path can itself be a mod root, otherwise its direct children are
  considered;
- a directory whose name begins with `@` is always an addon boundary, so nested
  optional `@...` folders are not exposed as separate addons;
- no arbitrary recursive filesystem crawl is performed;
- a single directory scan is capped at 10,000 entries.

A mod root is recognized by `mod.cpp`, `meta.cpp`, or a case-insensitive
`addons` directory.

Pressing **Rescan** now rebuilds the installed-addon catalog from every enabled
source. Display names come from `meta.cpp`, then `mod.cpp`, with the directory
name as a fallback.

## Steam Workshop on Linux

The Windows launcher commonly presents Workshop mods through a `!Workshop`
alias below the game directory. Native Steam on this Linux installation does
not create that alias. The authoritative content is stored directly at:

```text
<Steam library>/steamapps/workshop/content/107410/<published-id>
```

The Sources drawer offers **Add Workshop** as an explicit opt-in shortcut. The
launcher scans only Workshop entries that have a real mod root, ignoring
scenarios, compositions, and legacy placeholder files. `meta.cpp` supplies the
published ID and display name where present.

No `!Workshop` directory, symlink, or copied mod data is created. At launch,
the numeric directory's absolute native path will be translated into the Wine
`Z:\\...` path understood by Arma running through Proton.

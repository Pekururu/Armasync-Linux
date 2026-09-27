# Launch settings

Launcher settings are stored in `~/.config/armasync/launcher.toml`. The file
uses a strict schema and is written atomically.

The Launch screen saves settings automatically shortly after each change; there
is no Save button. Launching waits for any pending save, so Arma always starts
with what is on screen. A failed write is shown on the Launch screen with the
storage error, and the change stays on screen to retry.

Armasync passes no display-mode argument. Arma keeps its own saved window mode,
which avoids the input scaling and soft-image problems seen when the game was
accidentally running in Window mode. An older `displayMode` value in
`launcher.toml` is read and ignored.

The standard defaults are `-noLauncher`, `-noSplash`, and `-skipIntro`. Advanced
performance settings are optional and are not guessed from the host hardware.
Custom arguments are passed directly as individual process arguments, never
evaluated by a shell. They cannot override `-mod`, enable BattlEye, or contain
control characters.

The Launch button, in the launch dock and on Play, combines the saved settings
with the current ordered addon group. Local Linux addon paths are validated
against enabled sources and translated to Wine `Z:\` paths. Installed DLC uses
its engine handle. The complete ordered list is passed as one `-mod=` argument
through `protontricks-launch` for Steam app 107410.

Addon groups, their exact load order, and optional repository-modset link are
stored atomically in `~/.config/armasync/addon-groups.toml`. Groups can be
created, renamed, duplicated, or deleted. Duplicating a repository-linked group
creates an independent copy so later repository updates cannot overwrite it.

Everything on the Mods screen works without a mouse too. In either list, the
arrow keys, Home and End move between rows, and the Menu key or Shift+F10 opens
a row's menu. In Installed addons, Enter adds the focused addon to the group. In
the group, Alt+↑ and Alt+↓ move the focused addon one place, Alt+Home and
Alt+End move it to the top or bottom, and Delete removes it.

The Launch screen lists player profiles and saved servers. Player identities can
be added, renamed, and removed from the launcher without deleting their Arma
profile files. Choosing a profile in the list makes it the one used at launch.
Direct-connect servers can be saved with a friendly name, hostname/IP, port, and
optional password.

The launch dock at the bottom of every screen except Play, and the launch card
on Play, contain only three per-launch selectors: addon group, server, and
player profile. Selecting no server opens Arma at the main menu. An
optional server password is part of the locally stored server configuration and
is excluded from command previews.

The profile manager suggests actual `*.Arma3Profile` identities. Arma's
`.vars.Arma3Profile` and `.3den.Arma3Profile` companion files are hidden. Profile
filenames using percent-encoded spaces are decoded for display. Users can select
an existing identity or type a validated new player name in the profile picker;
`-name=` makes Arma create that profile on the next launch. Choosing **Automatic**
uses Proton's default `steamuser` identity.

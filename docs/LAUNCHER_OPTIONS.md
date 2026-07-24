# Configuration

Launcher settings are stored in `~/.config/armasync/launcher.toml`. The file
uses a strict schema and is written atomically.

The recommended display option does not pass a display-mode argument. Arma keeps
its own saved Fullscreen Window setting, avoiding the input scaling and soft-image
problems encountered when the game was accidentally running in Window mode.
Windowed and borderless-window modes use the documented `-window` and
`-noWindowBorder` startup parameters.

The standard defaults are `-noLauncher`, `-noSplash`, and `-skipIntro`. Advanced
performance settings are optional and are not guessed from the host hardware.
Custom arguments are passed directly as individual process arguments, never
evaluated by a shell. They cannot override `-mod`, enable BattlEye, or contain
control characters.

The footer launch action now combines the saved settings with the current ordered
addon group. Local Linux addon paths are validated against enabled sources and
translated to Wine `Z:\` paths. Installed DLC uses its engine handle. The complete
ordered list is passed as one `-mod=` argument through `protontricks-launch` for
Steam app 107410.

Addon groups, their exact load order, and optional repository-modset link are
stored atomically in `~/.config/armasync/addon-groups.toml`. Groups can be
created, renamed, duplicated, or deleted. Duplicating a repository-linked group
creates an independent copy so later repository updates cannot overwrite it.

The Configuration tab provides profile and server managers. Player identities can
be added, renamed, and removed from the launcher without deleting their Arma
profile files. Direct-connect servers can be saved with a friendly name,
hostname/IP, port, and optional password.

The bottom launch bar contains only three per-launch selectors: addon group,
server, and player profile. Selecting no server opens Arma at the main menu. An
optional server password is part of the locally stored server configuration and
is excluded from command previews.

The profile manager suggests actual `*.Arma3Profile` identities. Arma's
`.vars.Arma3Profile` and `.3den.Arma3Profile` companion files are hidden. Profile
filenames using percent-encoded spaces are decoded for display. Users can select
an existing identity or type a validated new player name in the profile picker;
`-name=` makes Arma create that profile on the next launch. Leaving it blank uses
Proton's default `steamuser` identity.

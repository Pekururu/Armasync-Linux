# DLC detection and launch model

Selectable DLC is distinct from repository, Workshop, and local mods in the
launcher data model. It nevertheless participates in the same ordered Arma
`-mod=` value by its engine handle.

## Selectable content

| Content | Handle | Steam app ID | Directory |
| --- | --- | ---: | --- |
| Contact | `contact` | 1021790 | `Contact` |
| Global Mobilization | `gm` | 1042220 | `GM` |
| S.O.G. Prairie Fire | `vn` | 1227700 | `VN` |
| CSLA Iron Curtain | `csla` | 1294440 | `CSLA` |
| Western Sahara | `ws` | 1681170 | `WS` |
| Spearhead 1944 | `spe` | 1175380 | `SPE` |
| Reaction Forces | `rf` | 2647760 | `RF` |
| Expeditionary Forces | `ef` | 2647830 | `EF` |

Official content mounted automatically by the platform, such as Jets, Tanks,
Helicopters, and Laws of War, is not shown as selectable addon content.

## Detection

The backend discovers the native Steam roots and libraries through
`libraryfolders.vdf`, then reads `appmanifest_107410.acf` from the library that
contains Arma 3. A selectable DLC is classified using both its mounted Steam
depot and its case-insensitively matched game directory:

- `installed`: the DLC depot is mounted and the payload directory exists;
- `disabled`: Steam lists the app ID in `DisabledDLC`;
- `files_only`: a directory exists without a mounted DLC depot;
- `incomplete`: the depot is mounted but its directory is missing;
- `unavailable`: neither the depot nor directory is present.

Only `installed` DLC can be added from the catalog. A group may retain an
unavailable DLC requirement after importing a unit preset; that requirement is
shown and blocks launch instead of being silently discarded.

Workshop compatibility packs remain ordinary Workshop mods. They do not prove
ownership of the corresponding Creator DLC and are never reclassified as DLC.

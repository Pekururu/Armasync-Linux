# Application icon

The Armasync logo: a plate carrier with a terminal prompt, drawn by the project
owner (2026-09-27). It comes in two forms.

**The mark on its own**, white or near-black on transparency. Use this wherever
the background is known:

- `src/Logo.tsx`: in the app, drawn in the current text colour so it follows
  the theme.
- `docs/logo/logo-white.svg` and `docs/logo/logo-dark.svg`: the README, picked
  by GitHub's dark or light theme.

All three share one path, rebuilt as a vector from the original drawing and
snapped to its centre line. Change the path in all three together.

**The app icon**, the mark on a grey KalmUI tile with a slightly lighter
outline. Desktops, launchers and taskbars have unknown backgrounds, so the icon
brings its own. The master is `source.svg` in this directory. `source-1024.png`
is rendered from it:

```sh
rsvg-convert -w 1024 -h 1024 src-tauri/icons/source.svg -o src-tauri/icons/source-1024.png
```

- SHA-256 of `source-1024.png`: `48ba03d1d385f891d2a89a4baf6405f9f3bf5cb22ad90e12adf285feccb05357`

All platform icon files in this directory were generated from that PNG with
`pnpm tauri icon src-tauri/icons/source-1024.png`. Re-run that command after
changing the master. This is a Linux desktop application, so the non-Linux
outputs it produces are deleted afterwards: the `android/` and `ios/`
directories, the Windows files (`icon.ico`, `Square*Logo.png`,
`StoreLogo.png`), and the macOS `icon.icns`.

Known limit: the mark reads at 32 px (the smallest size shipped); at 16 px only
the carrier outline survives. If a tray icon is ever added, draw a simplified
variant.

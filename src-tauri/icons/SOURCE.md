# Application icon

The Armasync logo: dark sync arrows on an amber diamond, designed for the
project (2026-07-24). The canonical master is `source-1024.png` in this
directory (1024 × 1024 RGBA PNG).

- SHA-256: `3c69cc603a8378abbb6e5c85e956545efa6230378256220b4e3df2146bbce46b`

All platform icon files in this directory were generated from that master
with `pnpm tauri icon src-tauri/icons/source-1024.png`. Re-run that command
after changing the master. This is a Linux desktop application, so the
non-Linux outputs it produces are deleted afterwards: the `android/` and
`ios/` directories, the Windows files (`icon.ico`, `Square*Logo.png`,
`StoreLogo.png`), and the macOS `icon.icns`.

Known limit: the glyph is readable at 32 px (the smallest size shipped) but
not at 16 px; if a tray icon is ever added, draw a simplified variant.

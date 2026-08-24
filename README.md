# Screenshot Studio

Cross-platform (Windows / macOS / Linux) tray-resident screenshot capture tool with a built-in annotation editor.

Press a global hotkey → select a screen region → annotate with pen, arrows, shapes, text and blur → export to clipboard or save as PNG/JPEG.

Built with **Electron 33 + TypeScript + React 18 + Vite + Konva.js**. No backend — everything stays on your machine.

---

## Table of contents

- [Install (end users)](#install-end-users)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Linux](#linux)
- [Development](#development)
- [Building installers yourself](#building-installers-yourself)
- [Releasing](#releasing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

---

## Install (end users)

Grab the installer for your platform from the [Releases page](https://github.com/andrewkikot/screen-studio/releases).

### Windows

| | |
|---|---|
| Installer | `Screenshot Studio Setup <version>.exe` (NSIS) |
| Architecture | x64 |
| Auto-update | Yes |

1. Download and run the `.exe`.
2. Follow the installer (you can pick the installation directory).
3. Screenshot Studio starts in the system tray. Use the tray icon or the global hotkey to capture.

> **Note:** the app is currently unsigned, so SmartScreen may show a warning ("Windows protected your PC"). Click *More info* → *Run anyway*.

### macOS

| | |
|---|---|
| Installer | `Screenshot Studio <version>.dmg` |
| Architecture | Universal / arm64-x64 depending on release |
| Auto-update | Only for **signed** builds |

1. Download and open the `.dmg`.
2. Drag **Screenshot Studio** into `Applications`.
3. Launch it — it lives in the menu bar (tray).

**Screen Recording permission is required.** On first capture macOS will prompt you:
*System Settings → Privacy & Security → Screen & System Audio Recording* → enable **Screenshot Studio**, then restart the app.

> **Notes for signed builds:** macOS updates via electron-updater require a signed (and ideally notarized) app. Unsigned builds must be re-installed manually. If Gatekeeper blocks an unsigned download: right-click the app → *Open*, or run `xattr -cr "/Applications/Screenshot Studio.app"`.

### Linux

| | |
|---|---|
| Installers | `Screenshot Studio <version>.AppImage`, `screenshot-studio_<version>_amd64.deb` |
| Architecture | x64 |
| Auto-update | **AppImage only** (the deb target does not support electron-updater) |

**AppImage (recommended):**

```bash
chmod +x Screenshot-Studio-<version>.AppImage
./Screenshot-Studio-<version>.AppImage
```

Optionally integrate it into your app menu with [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

**deb (Debian/Ubuntu/Mint etc.):**

```bash
sudo apt install ./screenshot-studio_<version>_amd64.deb
```

Deb installs receive no automatic updates — install the new `.deb` manually to upgrade.

**Linux-specific requirements:**

- A compositor supporting transparency (needed for the region-select overlay). Works on KDE, GNOME, Hyprland, most modern setups.
- On **Wayland**, if the overlay or shortcuts misbehave, try launching with XWayland:
  ```bash
  ./Screenshot-Studio-*.AppImage --ozone-platform-hint=auto
  ```
- Global shortcut registration may vary between desktop environments; the tray icon always works as a fallback.

---

## Development

### Prerequisites

- **Node.js** ≥ 20 (LTS recommended), npm ≥ 10
- Platform extras for Electron:
  - Windows: nothing extra
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `libgtk-3-dev libnss3-dev libasound2-dev` (or equivalents) so Electron can run/build native bits

### Getting started

```bash
git clone https://github.com/andrewkikot/screen-studio.git
cd screenshot-studio
npm install
npm run dev     # icons are auto-generated before dev starts
```

### Commands

```bash
npm run dev          # dev mode with HMR
npm run typecheck    # MUST pass before any commit (node + web tsconfigs)
npm run build        # production build -> out/
npm run dist         # build + electron-builder installers
npm run icons        # regenerate build/icon.png/.ico + resources/tray*.png
```

There is no lint config — `npm run typecheck` is the gate.

---

## Building installers yourself

`npm run dist` builds only for the **host OS**:

| Host | Output |
|---|---|
| Windows | NSIS installer (`.exe`) |
| macOS | `.dmg` |
| Linux | `.AppImage` + `.deb` |

Artifacts land in `release/`. Cross-compiling from another OS is not supported here — use CI instead (see below).

Signing is environment-driven; without secrets everything still builds **unsigned**:

| Platform | Variables |
|---|---|
| Windows / macOS code signing | `CSC_LINK`, `CSC_KEY_PASSWORD` |
| macOS notarization | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |

---

## Releasing

Releases are cut automatically by [.github/workflows/release.yml](.github/workflows/release.yml) on all three OSes and published to GitHub Releases (installers + `latest.yml` / `.blockmap` for electron-updater).

1. Bump `version` in `package.json` (must match the tag).
2. Commit.
3. Tag and push:
   ```bash
   git tag v0.1.2
   git push origin main --tags
   ```
4. CI builds and publishes the release. **electron-updater only sees published releases, never drafts.**

First real update test: install packaged vN locally, publish vN+1, then watch the tray flow (update dot → download % → restart installs).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Hotkey doesn't fire | Another app owns that shortcut — change it in Settings. On Linux/Wayland see the note above. |
| Overlay looks zoomed-in (HiDPI) | Fixed by design (`width/height: 100%` overlay image); if you see it, report your display scale factor. |
| macOS: black/blank captures | Grant Screen Recording permission, then fully quit and relaunch the app. |
| Linux: overlay invisible | Your window manager/compositor doesn't support transparency — enable compositing or use a DE that does. |
| Update never appears | Updates come from **published** GitHub Releases only; drafts are ignored. |
| SmartScreen/Gatekeeper warning | Expected for unsigned builds — see platform sections above. |

---

## Known limitations

- Multi-monitor: only the display under the cursor is captured; one overlay at a time
- No settings entry yet for capture delay or JPEG quality
- Editor has no zoom/pan, no resize handles for pen/arrow lines
- macOS requires Screen Recording permission; Linux needs a transparency-capable compositor
- deb packages don't auto-update (electron-updater limitation)

---

## License

[MIT](LICENSE)

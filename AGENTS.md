# AGENTS.md — Context for AI Agents

Working notes for any AI coding session touching this repo. Read before changing code.

## What this is

**Screenshot Studio** — cross-platform (Win/macOS/Linux) tray-resident screenshot capture tool with a built-in annotation editor. Electron 33 + TypeScript + React 18 + Vite (via `electron-vite`) + Konva.js. No backend; everything is local.

## Commands

```powershell
npm run dev          # dev mode (HMR); auto-generates icons first
npm run typecheck    # MUST pass: runs BOTH tsconfig.node.json and tsconfig.web.json
npm run build        # production build -> out/
npm run dist         # build + electron-builder installers
node scripts/gen-icons.mjs   # regenerates build/icon.png/.ico, resources/tray.png (dependency-free PNG encoder)
```

There is **no lint config**. `npm run typecheck` is the gate — always run it after edits.

## Architecture

Three Electron pages share one preload bridge (`window.api`, typed in `src/renderer/src/env.d.ts`):

| Page | Entry | Purpose |
|---|---|---|
| overlay | `src/renderer/src/overlay/` | transparent fullscreen region-select |
| editor | `src/renderer/src/editor/` | Konva annotation canvas |
| settings | `src/renderer/src/settings/` | hotkey recorder, save folder, format |

All pages are declared as separate inputs in `electron.vite.config.ts` — add new pages there too.

Flow: hotkey/tray → main grabs display under cursor via `desktopCapturer` → overlay shows frozen frame → selection rect sent over IPC → cropped in main (`nativeImage.crop`) → editor window opens with PNG dataURL → export to clipboard or file.

Key modules:
- `src/main/index.ts` — windows, tray, globalShortcut, all ipcMain handlers
- `src/main/config.ts` — hand-rolled JSON settings store at `userData/settings.json`
- `src/shared/types.ts` — single source of truth for IPC payloads and shape models; imported by BOTH tsconfig projects (keep it type-only)

## Conventions & gotchas (learned the hard way)

- **Strict TS everywhere**, no `any`. React function components annotated with `ReactElement`.
- **Konva shapes are stored in original-image pixel coordinates**; the stage is scaled by `view = fit-to-window`. Export uses `stage.toDataURL({ pixelRatio: 1 / view })` to restore full resolution. Don't "fix" this ratio.
- Ellipse shapes store bbox x/y (top-left) but render center-based — dragEnd math differs from rect (see `handleDragEnd`).
- Blur tool = cached `Img` node with crop + Pixelate filter; must call `node.cache()` after geometry changes.
- Import filters as `konva/lib/filters/Pixelate` — bare `konva/filters/Pixelate` has no types (package has no exports map).
- `react-konva` exports `Image` (aliased here as `KImage`) and `Rect` (aliased `KRect` because it clashes with the shared `Rect` type).
- **DPI**: captures are physical pixels; UI works in logical. Multiply by `display.scaleFactor` when crossing the boundary. The overlay `<img>` MUST be stretched to `width/height:100%` or HiDPI users see a zoomed screen.
- `electron-store` was deliberately avoided (ESM-only breaks CJS main). Use `config.ts`.
- Settings window re-registers the global hotkey on change and reverts if registration fails (checks `globalShortcut.isRegistered`).
- Tray icon path differs packaged vs dev — always go through `resourcePath()`.
- After changing code: `npm run build`, then kill `electron` processes and relaunch `node_modules\electron\dist\electron.exe` with working dir = repo root to test the built app.

## Known limitations / roadmap ideas

- Multi-monitor: only the display under the cursor is captured; one overlay at a time
- No settings entry yet for capture delay or JPEG quality
- macOS needs Screen Recording permission; Linux needs a compositor supporting transparency
- No CI packaging pipeline yet (electron-builder config exists)
- Editor has no zoom/pan, no resize handles for pen/arrow lines

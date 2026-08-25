import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray
} from 'electron'
import type { Display, NativeImage } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getSettings, setSettings } from './config'
import type { EditorShot, ExportRequest, Rect, Settings } from '../shared/types'
import { checkForUpdates, getUpdaterState, initUpdater, onUpdateState, startUpdate } from './updater'

interface Grab {
  image: NativeImage
  display: Display
}

let tray: Tray | null = null
let overlays: BrowserWindow[] = []
let pickers: BrowserWindow[] = []
const overlayShots = new Map<number, Grab>()
const pickerShots = new Map<number, Grab>()
let editor: BrowserWindow | null = null
let settings: BrowserWindow | null = null
let pendingShot: EditorShot | null = null
let gotLock = true

// Startup forensics land in a file so they're readable even when the app was launched
// from the GUI with no terminal attached. Delete this once the Wayland saga is over.
function debugLog(line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`
  console.error(`[ss] ${text.trimEnd()}`)
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(join(app.getPath('userData'), 'ss-startup.log'), text, { flag: 'a' })
  } catch {
    // logging must never block startup
  }
}

// Native-Wayland screen capture goes through xdg-desktop-portal ScreenCast, which pops
// GNOME's "pick a monitor to share" dialog before every grab, and globalShortcut is
// unreliable there. Ozone backend selection happens before main-process JS runs, so
// appendSwitch is too late — relaunch with a real --ozone-platform=x11 argv flag instead.
// Opt out with SS_OZONE=wayland; skipped automatically when XWayland is unavailable.
function reexecUnderX11IfNeeded(): void {
  const waylandSession = !!(
    process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland'
  )
  debugLog(
    `start v${app.getVersion()} pid=${process.pid} reexec=${process.env.SS_X11_REEXEC ?? '0'} ` +
      `wayland=${waylandSession} display=${process.env.DISPLAY ?? 'unset'} ` +
      `ss_ozone=${process.env.SS_OZONE ?? 'unset'} hint=${process.env.ELECTRON_OZONE_PLATFORM_HINT ?? 'unset'} ` +
      `argv0=${process.argv0}`
  )
  if (
    process.platform !== 'linux' ||
    process.env.SS_X11_REEXEC === '1' ||
    process.env.SS_OZONE === 'wayland' ||
    !waylandSession ||
    !process.env.DISPLAY
  ) {
    return
  }
  // process.argv loses raw Chromium flags injected by AppImage AppRun (e.g. --no-sandbox);
  // read the true argv so the child keeps them.
  const realArgv =
    process.platform === 'linux'
      ? readFileSync('/proc/self/cmdline', 'utf8')
          .split('\0')
          .filter(Boolean)
          .slice(1)
      : process.argv.slice(1)
  // Mirror electron-builder's AppRun probe: Ubuntu 24.04+ AppArmor usually blocks
  // unprivileged user namespaces, and Chromium then insists on a working SUID
  // chrome-sandbox — impossible inside a FUSE-mounted AppImage. The normal launch
  // gets --no-sandbox from AppRun; bypassing AppRun means we must provide it too.
  const args = [...realArgv, '--ozone-platform=x11']
  const userns = spawnSync('unshare', ['-Ur'], { stdio: 'ignore' })
  if (userns.error || userns.status !== 0) {
    args.push('--no-sandbox')
    debugLog('user namespaces unavailable -> appending --no-sandbox')
  }
  debugLog(`relaunching under x11: ${JSON.stringify(args)}`)
  const launchX11Child = (extraFlag: string | null): void => {
    const childArgs = extraFlag ? [extraFlag, ...args] : args
    const child = spawn(process.execPath, childArgs, {
      stdio: 'inherit',
      env: { ...process.env, SS_X11_REEXEC: '1' }
    })
    child.once('exit', (code, signal) => {
      if (extraFlag === null && ((code !== null && code !== 0) || signal !== null)) {
        debugLog(`x11 child failed code=${code} signal=${signal}; retrying with --no-sandbox`)
        launchX11Child('--no-sandbox')
        return
      }
      debugLog(`x11 child exited code=${code}`)
      app.exit(code ?? 0)
    })
  }
  launchX11Child(null)
  gotLock = false
}

reexecUnderX11IfNeeded()

if (gotLock) {
  gotLock = app.requestSingleInstanceLock()
}
debugLog(
  `lock=${gotLock} packaged=${app.isPackaged} exec=${process.execPath} ` +
    `hasOzoneSwitch=${app.commandLine.hasSwitch('ozone-platform')}`
)
if (!gotLock) app.quit()

app.on('second-instance', () => {
  void startCapture()
})

function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

function loadPage(win: BrowserWindow, page: string): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer', page))
  }
}

function displayHotkey(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => (p === 'CommandOrControl' ? (process.platform === 'darwin' ? 'Cmd' : 'Ctrl') : p))
    .join('+')
}

function updateMenuItems(): Electron.MenuItemConstructorOptions[] {
  const s = getUpdaterState()
  switch (s.phase) {
    case 'available':
      return [
        { label: `Update available${s.version ? ` (v${s.version})` : ''} — download`, click: () => void startUpdate() }
      ]
    case 'downloading':
      return [{ label: `Downloading update… ${s.percent}%`, enabled: false }]
    case 'ready':
      return [{ label: `Restart to install update`, click: () => void startUpdate() }]
    default:
      return [{ label: 'Check for updates', click: () => void checkForUpdates() }]
  }
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: `Capture (${displayHotkey(getSettings().hotkey)})`, click: () => void startCapture() },
    { label: `Color picker (${displayHotkey(getSettings().pickerHotkey)})`, click: () => void startPicker() },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    ...updateMenuItems(),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}

function refreshTray(): void {
  tray?.setContextMenu(buildTrayMenu())
  applyTrayBadge()
}

function applyTrayBadge(): void {
  if (!tray) return
  const s = getUpdaterState()
  tray.setImage(nativeImage.createFromPath(resourcePath(s.phase === 'idle' ? 'tray.png' : 'tray-update.png')))
  tray.setToolTip(
    s.phase === 'idle' || !s.version ? 'Screenshot Studio' : `Screenshot Studio — v${s.version} available`
  )
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Screenshot Studio')
  tray.setContextMenu(buildTrayMenu())
  onUpdateState(() => refreshTray())
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const s = getSettings()
  if (!globalShortcut.register(s.hotkey, () => void startCapture())) {
    console.warn(`global shortcut "${s.hotkey}" is already taken by another app`)
  }
  if (!globalShortcut.register(s.pickerHotkey, () => void startPicker())) {
    console.warn(`global shortcut "${s.pickerHotkey}" is already taken by another app`)
  }
}

async function grabAllDisplays(): Promise<Grab[]> {
  const displays = screen.getAllDisplays()
  const thumbnailSize = {
    width: Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor))),
    height: Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
  }
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const grabs: Grab[] = []
  const used = new Set<string>()
  for (const display of displays) {
    const source =
      sources.find((s) => s.display_id === String(display.id) && !used.has(s.id)) ??
      sources.find((s) => !used.has(s.id))
    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) continue
    used.add(source.id)
    grabs.push({ image: source.thumbnail, display })
  }
  return grabs
}

function destroyGroup(group: BrowserWindow[]): void {
  for (const win of [...group]) win.destroy()
}

function createCaptureWindow(
  group: BrowserWindow[],
  shots: Map<number, Grab>,
  grab: Grab,
  page: string,
  onDismiss: () => void
): BrowserWindow {
  const win = new BrowserWindow({
    x: grab.display.bounds.x,
    y: grab.display.bounds.y,
    width: grab.display.bounds.width,
    height: grab.display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  group.push(win)
  shots.set(win.id, grab)
  win.on('closed', () => {
    shots.delete(win.id)
    const i = group.indexOf(win)
    if (i !== -1) group.splice(i, 1)
  })
  win.on('blur', () => {
    if (!win.isVisible()) return
    setTimeout(() => {
      if (group.length === 0) return
      if (group.some((w) => !w.isDestroyed() && w.isFocused())) return
      onDismiss()
    }, 150)
  })
  win.once('ready-to-show', () => {
    if (win.isDestroyed() || !group.includes(win)) return
    win.setAlwaysOnTop(true, 'screen-saver')
    win.show()
    win.focus()
  })
  loadPage(win, page)
  return win
}

async function startCapture(): Promise<void> {
  if (overlays.length > 0 || pickers.length > 0 || !gotLock) return
  try {
    const grabs = await grabAllDisplays()
    if (grabs.length === 0) return
    for (const grab of grabs) createCaptureWindow(overlays, overlayShots, grab, 'overlay.html', () => cleanupCapture())
  } catch (err) {
    console.error('capture failed:', err)
    cleanupCapture()
  }
}

function cleanupCapture(): void {
  pendingShot = null
  overlayShots.clear()
  destroyGroup(overlays)
}

async function startPicker(): Promise<void> {
  if (overlays.length > 0 || pickers.length > 0 || !gotLock) return
  try {
    const grabs = await grabAllDisplays()
    if (grabs.length === 0) return
    for (const grab of grabs) createCaptureWindow(pickers, pickerShots, grab, 'picker.html', () => closePicker())
  } catch (err) {
    console.error('color picker failed:', err)
    closePicker()
  }
}

function closePicker(): void {
  pickerShots.clear()
  destroyGroup(pickers)
}

function openEditor(): void {  if (!pendingShot) return
  if (editor) {
    editor.destroy()
    editor = null
  }
  const wa = screen.getPrimaryDisplay().workArea
  const maxW = Math.floor(wa.width * 0.9)
  const maxH = Math.floor(wa.height * 0.9) - 120
  const scale = Math.min(1, maxW / pendingShot.width, maxH / pendingShot.height)
  const width = Math.max(560, Math.min(maxW, Math.round(pendingShot.width * scale)) + 32)
  const height = Math.max(440, Math.min(maxH, Math.round(pendingShot.height * scale)) + 152)

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 520,
    minHeight: 400,
    show: false,
    backgroundColor: '#0f172a',
    title: 'Screenshot Studio — Edit',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  editor = win
  win.on('closed', () => {
    if (editor === win) editor = null
  })
  win.once('ready-to-show', () => win.show())
  loadPage(win, 'editor.html')
}

function openSettings(): void {
  if (settings) {
    settings.focus()
    return
  }
  const win = new BrowserWindow({
    width: 540,
    height: 500,
    resizable: false,
    title: 'Screenshot Studio — Settings',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })
  settings = win
  win.on('closed', () => {
    if (settings === win) settings = null
  })
  win.once('ready-to-show', () => win.show())
  loadPage(win, 'settings.html')
}

ipcMain.handle('overlay:get-shot', (e) => {
  const grab = overlayShots.get(e.sender.id)
  if (!grab) return null
  return {
    dataUrl: grab.image.toDataURL(),
    width: grab.display.size.width,
    height: grab.display.size.height,
    scaleFactor: grab.display.scaleFactor
  }
})

ipcMain.handle('overlay:confirm', (e, rect: Rect) => {
  const grab = overlayShots.get(e.sender.id)
  if (!grab) return false
  const { image, display } = grab
  const s = display.scaleFactor
  const size = image.getSize()
  const px = {
    x: Math.max(0, Math.round(rect.x * s)),
    y: Math.max(0, Math.round(rect.y * s)),
    width: Math.max(0, Math.round(rect.width * s)),
    height: Math.max(0, Math.round(rect.height * s))
  }
  px.width = Math.min(px.width, size.width - px.x)
  px.height = Math.min(px.height, size.height - px.y)
  if (px.width < 8 || px.height < 8) return false
  const cropped = image.crop(px)
  pendingShot = {
    dataUrl: cropped.toDataURL(),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
  overlayShots.clear()
  destroyGroup(overlays)
  openEditor()
  return true
})

ipcMain.handle('overlay:cancel', () => {
  cleanupCapture()
})

ipcMain.handle('picker:get-shot', (e) => {
  const grab = pickerShots.get(e.sender.id)
  if (!grab) return null
  return {
    dataUrl: grab.image.toDataURL(),
    width: grab.display.size.width,
    height: grab.display.size.height,
    scaleFactor: grab.display.scaleFactor
  }
})

ipcMain.handle('picker:pick', (_e, hex: string) => {
  clipboard.writeText(hex)
  return true
})

ipcMain.handle('picker:cancel', () => {
  closePicker()
})

ipcMain.handle('editor:get-shot', () => pendingShot)

ipcMain.handle('editor:export', async (_e, req: ExportRequest) => {
  try {
    if (req.mode === 'clipboard') {
      clipboard.writeImage(nativeImage.createFromDataURL(req.dataUrl))
      return { ok: true }
    }
    if (req.mode === 'save') {
      const settings = getSettings()
      try {
        mkdirSync(settings.saveDir, { recursive: true })
      } catch {
        // fall through to dialog defaulting to user-writable location
      }
      const ext = settings.format === 'jpeg' ? 'jpg' : 'png'
      const stamp = new Date()
        .toISOString()
        .replace(/[:]/g, '')
        .replace(/[T.]/g, '-')
        .slice(0, 19)
      if (!editor) return { ok: false, error: 'no editor window' }
      const res = await dialog.showSaveDialog(editor, {
        title: 'Save screenshot',
        defaultPath: join(settings.saveDir, `Screenshot ${stamp}.${ext}`),
        filters: [
          { name: 'PNG image', extensions: ['png'] },
          { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }
        ]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      const img = nativeImage.createFromDataURL(req.dataUrl)
      const isJpg = /\.jpe?g$/i.test(res.filePath)
      writeFileSync(res.filePath, isJpg ? img.toJPEG(92) : img.toPNG())
      setSettings({ saveDir: dirname(res.filePath) })
      return { ok: true, path: res.filePath }
    }
    return { ok: false, error: 'unknown mode' }
  } catch (err) {
    console.error('export failed:', err)
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('settings:get', () => getSettings())

ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
  const prev = getSettings()
  setSettings(patch)
  if (patch.saveDir) {
    try {
      mkdirSync(patch.saveDir, { recursive: true })
    } catch {
      // directory creation failures surface when saving
    }
  }
  if (patch.hotkey && patch.hotkey !== prev.hotkey) {
    const revert: Partial<Settings> = { hotkey: prev.hotkey }
    registerHotkeys()
    if (!globalShortcut.isRegistered(patch.hotkey)) {
      setSettings(revert)
      registerHotkeys()
      refreshTray()
      return {
        ok: false,
        error: `${displayHotkey(patch.hotkey)} is taken by another app`,
        settings: getSettings()
      }
    }
  }
  if (patch.pickerHotkey && patch.pickerHotkey !== prev.pickerHotkey) {
    const revert: Partial<Settings> = { pickerHotkey: prev.pickerHotkey }
    registerHotkeys()
    if (!globalShortcut.isRegistered(patch.pickerHotkey)) {
      setSettings(revert)
      registerHotkeys()
      refreshTray()
      return {
        ok: false,
        error: `${displayHotkey(patch.pickerHotkey)} is taken by another app`,
        settings: getSettings()
      }
    }
  }
  refreshTray()
  return { ok: true, settings: getSettings() }
})

ipcMain.handle('settings:choose-dir', async () => {
  const parent = settings ?? undefined
  const res = await dialog.showOpenDialog(parent as BrowserWindow, {
    title: 'Choose save folder',
    defaultPath: getSettings().saveDir,
    properties: ['openDirectory', 'createDirectory']
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const dir = res.filePaths[0]
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // keep chosen path; save will report errors if unwritable
  }
  setSettings({ saveDir: dir })
  return dir
})

app.whenReady().then(() => {
  if (!gotLock) return
  Menu.setApplicationMenu(null)
  createTray()
  registerHotkeys()
  initUpdater()
  console.log('Screenshot Studio ready in tray')
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // stay alive in the tray
})

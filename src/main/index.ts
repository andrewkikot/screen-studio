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
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getSettings, setSettings } from './config'
import type { EditorShot, ExportRequest, Rect, Settings } from '../shared/types'
import { checkForUpdates, getUpdaterState, initUpdater, onUpdateState, startUpdate } from './updater'

let tray: Tray | null = null
let overlay: BrowserWindow | null = null
let editor: BrowserWindow | null = null
let settings: BrowserWindow | null = null
let currentImage: NativeImage | null = null
let currentDisplay: Display | null = null
let pendingShot: EditorShot | null = null

const gotLock = app.requestSingleInstanceLock()
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

function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const ok = globalShortcut.register(getSettings().hotkey, () => void startCapture())
  if (!ok) console.warn(`global shortcut "${getSettings().hotkey}" is already taken by another app`)
}

async function startCapture(): Promise<void> {
  if (overlay || !gotLock) return
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
    })
    if (sources.length === 0) return
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source.thumbnail || source.thumbnail.isEmpty()) return
    currentImage = source.thumbnail
    currentDisplay = display

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
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
    overlay = win
    win.on('closed', () => {
      if (overlay === win) overlay = null
    })
    win.on('blur', () => {
      if (overlay === win && win.isVisible()) cleanupCapture()
    })
    win.once('ready-to-show', () => {
      if (overlay !== win) return
      win.setAlwaysOnTop(true, 'screen-saver')
      win.show()
      win.focus()
    })
    loadPage(win, 'overlay.html')
  } catch (err) {
    console.error('capture failed:', err)
    cleanupCapture()
  }
}

function closeOverlay(): void {
  if (overlay) {
    overlay.destroy()
    overlay = null
  }
}

function cleanupCapture(): void {
  currentImage = null
  currentDisplay = null
  pendingShot = null
  closeOverlay()
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
    height: 400,
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

ipcMain.handle('overlay:get-shot', () => {
  if (!currentImage || !currentDisplay) return null
  return {
    dataUrl: currentImage.toDataURL(),
    width: currentDisplay.size.width,
    height: currentDisplay.size.height,
    scaleFactor: currentDisplay.scaleFactor
  }
})

ipcMain.handle('overlay:confirm', (_e, rect: Rect) => {
  const image = currentImage
  const display = currentDisplay
  if (!image || !display) return false
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
  currentImage = null
  currentDisplay = null
  closeOverlay()
  openEditor()
  return true
})

ipcMain.handle('overlay:cancel', () => {
  cleanupCapture()
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
    registerHotkey()
    if (!globalShortcut.isRegistered(patch.hotkey)) {
      setSettings({ hotkey: prev.hotkey })
      registerHotkey()
      refreshTray()
      return {
        ok: false,
        error: `${displayHotkey(patch.hotkey)} is taken by another app`,
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
  Menu.setApplicationMenu(null)
  createTray()
  registerHotkey()
  initUpdater()
  console.log('Screenshot Studio ready in tray')
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // stay alive in the tray
})

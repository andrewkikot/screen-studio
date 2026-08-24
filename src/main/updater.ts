import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

export type UpdaterPhase = 'idle' | 'available' | 'downloading' | 'ready'

export interface UpdaterState {
  phase: UpdaterPhase
  version: string | null
  percent: number
}

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let state: UpdaterState = { phase: 'idle', version: null, percent: 0 }
let timer: NodeJS.Timeout | undefined
let lastPercent = -1

const listeners = new Set<(s: UpdaterState) => void>()

function setState(next: UpdaterState): void {
  state = next
  for (const l of listeners) l(state)
}

function known(version: string | null): UpdaterState {
  return { phase: 'available', version, percent: 0 }
}

export function getUpdaterState(): UpdaterState {
  return state
}

export function onUpdateState(cb: (s: UpdaterState) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

async function checkNow(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('update check failed:', err)
    if (state.phase === 'downloading') setState(known(state.version))
    else if (state.phase !== 'ready') setState({ phase: 'idle', version: null, percent: 0 })
  }
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  await checkNow()
}

export async function startUpdate(): Promise<void> {
  if (state.phase === 'ready') {
    autoUpdater.quitAndInstall()
    return
  }
  if (state.phase !== 'available') return
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    console.error('update download failed:', err)
    setState(known(state.version))
  }
}

export function initUpdater(): void {
  if (!app.isPackaged) {
    console.log('updater disabled in dev (unpackaged)')
    return
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  autoUpdater.on('checking-for-update', () => {
    if (state.phase === 'idle') setState({ phase: 'idle', version: null, percent: 0 })
  })
  autoUpdater.on('update-available', (info) => {
    lastPercent = -1
    if (state.phase === 'downloading' || state.phase === 'ready') return
    setState(known(info.version ?? null))
  })
  autoUpdater.on('update-not-available', () => {
    if (state.phase !== 'ready') setState({ phase: 'idle', version: null, percent: 0 })
  })
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.floor(p.percent)
    if (pct === lastPercent || !state.version) return
    lastPercent = pct
    setState({ phase: 'downloading', version: state.version, percent: pct })
  })
  autoUpdater.on('update-downloaded', (info) => {
    lastPercent = 100
    setState({ phase: 'ready', version: info.version ?? state.version, percent: 100 })
  })
  autoUpdater.on('error', (err) => {
    console.error('updater error:', err)
    if (state.phase === 'downloading') setState(known(state.version))
    else if (state.phase !== 'ready') setState({ phase: 'idle', version: null, percent: 0 })
  })

  timer = setInterval(() => void checkNow(), CHECK_INTERVAL_MS)
  timer.unref()
  setTimeout(() => void checkNow(), 15_000).unref()
}

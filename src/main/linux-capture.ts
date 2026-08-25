import { app, nativeImage, screen } from 'electron'
import type { Display, NativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { unlinkSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export interface Grab {
  image: NativeImage
  display: Display
}

/* ── session detection ────────────────────────────────────────────────── */

export function isWaylandSession(): boolean {
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
}

function isGNOMESession(): boolean {
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? '').toLowerCase()
  return desktop.includes('gnome') || desktop.includes('unity') || desktop.includes('budgie')
}

/* ── GNOME Shell Screenshot D-Bus API ─────────────────────────────────── */

let gnomeShellAvailable: boolean | null = null

async function probeGNOMEShell(): Promise<boolean> {
  if (gnomeShellAvailable !== null) return gnomeShellAvailable
  try {
    await execFileAsync('gdbus', [
      'call', '--session',
      '--dest', 'org.gnome.Shell.Screenshot',
      '--object-path', '/org/gnome/Shell/Screenshot',
      '--method', 'org.gnome.Shell.Screenshot.Screenshot',
      'false', 'false', join(app.getPath('temp'), `ss-probe-${process.pid}.png`)
    ], { timeout: 3000 })
    gnomeShellAvailable = true
  } catch {
    gnomeShellAvailable = false
  }
  // clean up probe file
  try { unlinkSync(join(app.getPath('temp'), `ss-probe-${process.pid}.png`)) } catch { /* */ }
  return gnomeShellAvailable
}

async function captureFullScreenGNOME(): Promise<NativeImage | null> {
  const tmpPath = join(app.getPath('temp'), `ss-gnome-${Date.now()}-${process.pid}.png`)
  try {
    const { stdout } = await execFileAsync('gdbus', [
      'call', '--session',
      '--dest', 'org.gnome.Shell.Screenshot',
      '--object-path', '/org/gnome/Shell/Screenshot',
      '--method', 'org.gnome.Shell.Screenshot.Screenshot',
      'false', 'false', tmpPath
    ], { timeout: 5000 })
    if (!stdout.includes('(true')) return null
    const image = nativeImage.createFromPath(tmpPath)
    if (image.isEmpty()) return null
    return image
  } catch {
    return null
  } finally {
    try { unlinkSync(tmpPath) } catch { /* */ }
  }
}

/* ── image splitting ──────────────────────────────────────────────────── */

function splitByDisplays(fullImage: NativeImage): Grab[] {
  const displays = screen.getAllDisplays()
  const grabs: Grab[] = []
  const fullSize = fullImage.getSize()

  // Compute the total logical screen extents so we can derive a scale
  // factor between the compositor's pixel space and Electron's logical space.
  let totalW = 0
  let totalH = 0
  for (const d of displays) {
    totalW = Math.max(totalW, d.bounds.x + d.bounds.width)
    totalH = Math.max(totalH, d.bounds.y + d.bounds.height)
  }
  if (totalW === 0 || totalH === 0) return grabs
  const sx = fullSize.width / totalW
  const sy = fullSize.height / totalH

  for (const display of displays) {
    const px = {
      x: Math.max(0, Math.round(display.bounds.x * sx)),
      y: Math.max(0, Math.round(display.bounds.y * sy)),
      width: Math.max(0, Math.round(display.bounds.width * sx)),
      height: Math.max(0, Math.round(display.bounds.height * sy))
    }
    px.width = Math.min(px.width, fullSize.width - px.x)
    px.height = Math.min(px.height, fullSize.height - px.y)
    if (px.width > 0 && px.height > 0) {
      grabs.push({ image: fullImage.crop(px), display })
    }
  }
  return grabs
}

/* ── xdg-desktop-portal via Python helper (persistent restore token) ──── */

function helperScript(): string {
  // In packaged builds, extraResources are placed in process.resourcesPath
  if (app.isPackaged) return join(process.resourcesPath, 'portal-capture.py')
  // In dev mode the script lives in scripts/ next to the source
  return join(app.getAppPath(), 'scripts', 'portal-capture.py')
}

function tokenFile(): string {
  return join(app.getPath('userData'), 'portal-restore-token')
}

function loadRestoreToken(): string {
  try {
    if (existsSync(tokenFile())) return readFileSync(tokenFile(), 'utf8').trim()
  } catch { /* */ }
  return ''
}

function saveRestoreToken(token: string): void {
  try { writeFileSync(tokenFile(), token) } catch { /* */ }
}

async function captureViaPortalScript(): Promise<NativeImage | null> {
  const script = helperScript()
  if (!existsSync(script)) return null

  const token = loadRestoreToken()
  const tmpPath = join(app.getPath('temp'), `ss-portal-${Date.now()}-${process.pid}.png`)

  try {
    const args = [script, tmpPath]
    if (token) args.push(token)

    const { stdout } = await execFileAsync('python3', args, { timeout: 15000 })

    // The helper writes the new restore_token to stdout on the last line
    // if it starts with "TOKEN:", save it.
    const lines = stdout.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    if (lastLine.startsWith('TOKEN:')) {
      saveRestoreToken(lastLine.slice(6))
    }

    if (!existsSync(tmpPath)) return null
    const image = nativeImage.createFromPath(tmpPath)
    if (image.isEmpty()) return null
    return image
  } catch {
    return null
  } finally {
    try { unlinkSync(tmpPath) } catch { /* */ }
  }
}

/* ── public API ───────────────────────────────────────────────────────── */

/**
 * Capture all displays on Linux/Wayland using the best available method.
 *
 * 1. GNOME Shell Screenshot D-Bus  — zero portal involvement (fastest)
 * 2. xdg-desktop-portal via Python — persistent restore_token (one-time dialog)
 * 3. null → caller falls back to desktopCapturer.getSources (XWayland path)
 */
export async function grabAllDisplaysLinux(): Promise<Grab[] | null> {
  if (!isWaylandSession()) return null

  // Method 1: GNOME Shell Screenshot — bypasses portal entirely
  if (isGNOMESession() && (await probeGNOMEShell())) {
    const fullImage = await captureFullScreenGNOME()
    if (fullImage) {
      const grabs = splitByDisplays(fullImage)
      if (grabs.length > 0) return grabs
    }
  }

  // Method 2: xdg-desktop-portal ScreenCast with persistent restore token
  const portalImage = await captureViaPortalScript()
  if (portalImage) {
    const grabs = splitByDisplays(portalImage)
    if (grabs.length > 0) return grabs
  }

  // Method 3: caller falls through to desktopCapturer (XWayland)
  return null
}

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/types'

export type { Settings }

let cache: Settings | null = null

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (cache) return cache
  const defaults: Settings = {
    hotkey: 'CommandOrControl+Shift+S',
    pickerHotkey: 'CommandOrControl+Shift+C',
    saveDir: join(app.getPath('pictures'), 'Screenshot Studio'),
    format: 'png'
  }
  try {
    if (existsSync(file())) {
      cache = { ...defaults, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>) }
    } else {
      cache = defaults
    }
  } catch {
    cache = defaults
  }
  return cache
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  cache = next
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('failed to persist settings:', err)
  }
  return next
}

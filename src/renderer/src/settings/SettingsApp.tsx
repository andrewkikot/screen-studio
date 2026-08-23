import { useEffect, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { ImageFormat, Settings } from '../../../shared/types'

const isMac = /Mac/i.test(navigator.platform)

function pretty(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => {
      if (p === 'CommandOrControl' || p === 'Command') return isMac ? 'Cmd' : 'Ctrl'
      if (p === 'CommandOrControl') return 'Ctrl'
      return p
    })
    .join(' + ')
}

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/'
}

function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  let key = ''
  const c = e.code
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3)
  else if (/^Digit\d$/.test(c)) key = c.slice(5)
  else if (/^Numpad\d$/.test(c)) key = `num${c.slice(6)}`
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c
  else if (c in NAMED_KEYS) key = NAMED_KEYS[c]
  if (!key || mods.length === 0) return null
  return [...mods, key].join('+')
}

export default function SettingsApp(): ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [recording, setRecording] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
  }, [])

  const applyPatch = async (patch: Partial<Settings>): Promise<boolean> => {
    const res = await window.api.setSettings(patch)
    setSettings(res.settings)
    setMsg(res.ok ? { text: 'Saved' } : { text: res.error ?? 'Failed', bad: true })
    return res.ok
  }

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        setMsg(null)
        return
      }
      const acc = acceleratorFromEvent(e)
      if (!acc) {
        setMsg({ text: 'Use a letter, number or F-key together with Ctrl/Alt/Shift', bad: true })
        return
      }
      void window.api.setSettings({ hotkey: acc }).then((res) => {
        setSettings(res.settings)
        if (res.ok) {
          setRecording(false)
          setMsg({ text: `Shortcut set to ${pretty(acc)}` })
        } else {
          setMsg({ text: res.error ?? `${pretty(acc)} is not available`, bad: true })
        }
      })
    }
    const onBlur = (): void => setRecording(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [recording])

  const browse = async (): Promise<void> => {
    const dir = await window.api.chooseDir()
    if (dir) {
      setMsg({ text: 'Save folder updated' })
      setSettings((s) => (s ? { ...s, saveDir: dir } : s))
    }
  }

  const onFormatChange = (e: ReactKeyboardEvent<HTMLSelectElement> | { target: { value: string } }): void => {
    void applyPatch({ format: (e.target as HTMLSelectElement).value as ImageFormat })
  }

  if (!settings) {
    return <div className="settings-root empty">Loading…</div>
  }

  return (
    <div className="settings-root">
      <header className="s-header">
        <h1>Settings</h1>
      </header>

      <section className="s-section">
        <h2>Capture shortcut</h2>
        <div className="s-row">
          <button
            type="button"
            className={`hotkey-box${recording ? ' recording' : ''}`}
            onClick={() => {
              setMsg(null)
              setRecording(true)
            }}
            title="Click to record a new shortcut"
          >
            {recording ? 'Press keys… (Esc to cancel)' : pretty(settings.hotkey)}
          </button>
          {!recording && (
            <button type="button" className="s-btn" onClick={() => setRecording(true)}>
              Change
            </button>
          )}
        </div>
        <p className="s-hint">Global shortcut — works in any app. Combine a key with Ctrl, Alt and/or Shift.</p>
      </section>

      <section className="s-section">
        <h2>Saving</h2>
        <div className="s-row">
          <span className="s-path" title={settings.saveDir}>
            {settings.saveDir}
          </span>
          <button type="button" className="s-btn" onClick={() => void browse()}>
            Browse…
          </button>
        </div>
        <div className="s-row">
          <label htmlFor="fmt">Format</label>
          <select id="fmt" value={settings.format} onChange={onFormatChange}>
            <option value="png">PNG (lossless)</option>
            <option value="jpeg">JPEG (smaller)</option>
          </select>
          <span className="s-note">default for Save…</span>
        </div>
      </section>

      <footer className="s-footer">
        <span className={`s-msg${msg?.bad ? ' bad' : ''}`}>{msg?.text}</span>
        <button type="button" className="s-btn ghost" onClick={() => window.close()}>
          Close
        </button>
      </footer>
    </div>
  )
}

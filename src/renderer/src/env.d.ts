import type {
  EditorShot,
  ExportRequest,
  ExportResult,
  OverlayShot,
  Rect,
  Settings
} from '../../shared/types'

export interface SettingsResult {
  ok: boolean
  error?: string
  settings: Settings
}

declare global {
  interface Window {
    api: {
      getOverlayShot(): Promise<OverlayShot | null>
      confirmSelection(rect: Rect): Promise<boolean>
      cancelCapture(): Promise<void>
      getPickerShot(): Promise<OverlayShot | null>
      pickColor(hex: string): Promise<boolean>
      cancelPicker(): Promise<void>
      getEditorShot(): Promise<EditorShot | null>
      exportShot(req: ExportRequest): Promise<ExportResult>
      getSettings(): Promise<Settings>
      setSettings(patch: Partial<Settings>): Promise<SettingsResult>
      chooseDir(): Promise<string | null>
    }
  }
}

export {}

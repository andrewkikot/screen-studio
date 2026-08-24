export type ImageFormat = 'png' | 'jpeg'

export interface Settings {
  hotkey: string
  pickerHotkey: string
  saveDir: string
  format: ImageFormat
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface OverlayShot {
  dataUrl: string
  width: number
  height: number
  scaleFactor: number
}

export interface EditorShot {
  dataUrl: string
  width: number
  height: number
}

export type ExportMode = 'clipboard' | 'save'

export interface ExportRequest {
  mode: ExportMode
  dataUrl: string
}

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export type ToolId = 'select' | 'crop' | 'rect' | 'ellipse' | 'arrow' | 'pen' | 'text' | 'number' | 'blur'

export interface ShapeBase {
  id: string
  color: string
  strokeWidth: number
}

export type Shape = ShapeBase &
  (
    | { kind: 'rect'; x: number; y: number; width: number; height: number }
    | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
    | { kind: 'blur'; x: number; y: number; width: number; height: number }
    | { kind: 'arrow'; points: number[] }
    | { kind: 'pen'; points: number[] }
    | { kind: 'text'; x: number; y: number; text: string; fontSize: number }
    | { kind: 'number'; x: number; y: number; n: number }
  )

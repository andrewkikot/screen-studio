import { contextBridge, ipcRenderer } from 'electron'
import type { ExportRequest, Rect } from '../shared/types'

const api = {
  getOverlayShot: (): Promise<unknown> => ipcRenderer.invoke('overlay:get-shot'),
  confirmSelection: (rect: Rect): Promise<boolean> => ipcRenderer.invoke('overlay:confirm', rect),
  cancelCapture: (): Promise<void> => ipcRenderer.invoke('overlay:cancel'),
  getEditorShot: (): Promise<unknown> => ipcRenderer.invoke('editor:get-shot'),
  exportShot: (req: ExportRequest): Promise<unknown> => ipcRenderer.invoke('editor:export', req),
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('settings:set', patch),
  chooseDir: (): Promise<unknown> => ipcRenderer.invoke('settings:choose-dir')
}

contextBridge.exposeInMainWorld('api', api)

import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import type { OverlayShot } from '../../../shared/types'

const LENS = 132
const LABEL_H = 56
const MIN_ZOOM = 4
const MAX_ZOOM = 24
const CLOSE_DELAY = 700

interface CursorInfo {
  x: number
  y: number
  color: string | null
}

interface Sampler {
  ctx: CanvasRenderingContext2D
  scale: number
  width: number
  height: number
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export default function Picker(): ReactElement {
  const [shot, setShot] = useState<OverlayShot | null>(null)
  const [cursor, setCursor] = useState<CursorInfo | null>(null)
  const [zoom, setZoom] = useState(10)
  const [copied, setCopied] = useState<string | null>(null)
  const samplerRef = useRef<Sampler | null>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    void window.api.getPickerShot().then((s) => {
      if (!s) return
      setShot(s)
      const img = new Image()
      img.onload = () => {
        const w = Math.round(s.width * s.scaleFactor)
        const h = Math.round(s.height * s.scaleFactor)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        samplerRef.current = { ctx, scale: s.scaleFactor, width: w, height: h }
      }
      img.src = s.dataUrl
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !doneRef.current) void window.api.cancelPicker()
    }
    const onWheel = (e: WheelEvent): void => {
      if (doneRef.current) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 2 : -2
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + step)))
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])

  const sampleAt = (x: number, y: number): string | null => {
    const sp = samplerRef.current
    if (!sp) return null
    const px = Math.min(sp.width - 1, Math.max(0, Math.round(x * sp.scale)))
    const py = Math.min(sp.height - 1, Math.max(0, Math.round(y * sp.scale)))
    const d = sp.ctx.getImageData(px, py, 1, 1).data
    return toHex(d[0], d[1], d[2])
  }

  const onMouseMove = (e: ReactMouseEvent): void => {
    if (doneRef.current) return
    e.preventDefault()
    setCursor({ x: e.clientX, y: e.clientY, color: sampleAt(e.clientX, e.clientY) })
  }

  const onMouseDown = (e: ReactMouseEvent): void => {
    if (e.button !== 0 || doneRef.current) return
    e.preventDefault()
    const hex = sampleAt(e.clientX, e.clientY)
    if (!hex) return
    doneRef.current = true
    setCursor({ x: e.clientX, y: e.clientY, color: hex })
    setCopied(hex)
    void window.api.pickColor(hex).then(() => {
      window.setTimeout(() => void window.api.cancelPicker(), CLOSE_DELAY)
    })
  }

  const vw = shot?.width ?? 0
  const vh = shot?.height ?? 0
  let lx = 0
  let ly = 0
  if (cursor) {
    lx = Math.min(Math.max(cursor.x - LENS / 2, 6), Math.max(6, vw - LENS - 6))
    ly = Math.min(
      Math.max(cursor.y - LENS / 2 - LABEL_H / 2, 6),
      Math.max(6, vh - LENS - LABEL_H - 6)
    )
  }

  const hex = cursor?.color
  const r = hex ? parseInt(hex.slice(1, 3), 16) : 0
  const g = hex ? parseInt(hex.slice(3, 5), 16) : 0
  const b = hex ? parseInt(hex.slice(5, 7), 16) : 0

  return (
    <div
      className="picker-root"
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!doneRef.current) void window.api.cancelPicker()
      }}
    >
      {shot && <img className="picker-bg" src={shot.dataUrl} alt="" draggable={false} />}
      {shot && cursor && (
        <div className="lens-wrap" style={{ left: lx, top: ly }}>
          <div className="lens" style={{ width: LENS, height: LENS }}>
            <img
              src={shot.dataUrl}
              alt=""
              draggable={false}
              style={{
                width: vw * zoom,
                height: vh * zoom,
                left: LENS / 2 - cursor.x * zoom,
                top: LENS / 2 - cursor.y * zoom
              }}
            />
            <div className="lens-crossh" />
            <div className="lens-crossv" />
          </div>
          <div className={`lens-label${copied ? ' copied' : ''}`} style={{ width: LENS }}>
            {copied ? (
              <span className="lens-copied">Copied {copied}</span>
            ) : hex ? (
              <>
                <span className="lens-row">
                  <span className="lens-swatch" style={{ background: hex }} />
                  <span className="lens-hex">{hex}</span>
                </span>
                <span className="lens-rgb">
                  {r}, {g}, {b}
                </span>
              </>
            ) : (
              <span className="lens-rgb">…</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

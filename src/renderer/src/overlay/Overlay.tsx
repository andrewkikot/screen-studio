import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Point, Rect } from '../../../shared/types'

const MIN_SIZE = 8

export default function Overlay() {
  const [bg, setBg] = useState<string | null>(null)
  const [dims, setDims] = useState({ width: 0, height: 0 })
  const [rect, setRect] = useState<Rect | null>(null)
  const startRef = useRef<Point | null>(null)
  const rectRef = useRef<Rect | null>(null)

  useEffect(() => {
    void window.api.getOverlayShot().then((shot) => {
      if (!shot) return
      setBg(shot.dataUrl)
      setDims({ width: shot.width, height: shot.height })
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api.cancelCapture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const update = (r: Rect | null): void => {
    rectRef.current = r
    setRect(r)
  }

  const onMouseDown = (e: ReactMouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    startRef.current = { x: e.clientX, y: e.clientY }
    update({ x: e.clientX, y: e.clientY, width: 0, height: 0 })
  }

  const onMouseMove = (e: ReactMouseEvent): void => {
    const start = startRef.current
    if (!start) return
    e.preventDefault()
    const x = Math.min(start.x, e.clientX)
    const y = Math.min(start.y, e.clientY)
    const w = Math.abs(e.clientX - start.x)
    const h = Math.abs(e.clientY - start.y)
    update({
      x,
      y,
      width: Math.min(w, dims.width - x),
      height: Math.min(h, dims.height - y)
    })
  }

  const onMouseUp = (): void => {
    const r = rectRef.current
    startRef.current = null
    update(null)
    if (r && r.width >= MIN_SIZE && r.height >= MIN_SIZE) {
      void window.api.confirmSelection(r)
    } else {
      void window.api.cancelCapture()
    }
  }

  return (
    <div
      className={`overlay-root${rect ? '' : ' dimmed'}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => {
        e.preventDefault()
        void window.api.cancelCapture()
      }}
    >
      {bg && <img className="overlay-bg" src={bg} alt="" draggable={false} />}
      {rect && (
        <div
          className="overlay-sel"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <div className="overlay-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </div>
      )}
    </div>
  )
}

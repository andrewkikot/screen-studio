import { useEffect, useReducer, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import Konva from 'konva'
import { Pixelate } from 'konva/lib/filters/Pixelate'
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KImage,
  Layer,
  Line,
  Rect as KRect,
  Stage,
  Text,
  Transformer
} from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import Toolbar, { COLORS } from './Toolbar'
import type { EditorShot, Point, Rect, Shape, ToolId } from '../../../shared/types'

interface Doc {
  base: EditorShot
  shapes: Shape[]
}

interface TextDraft {
  x: number
  y: number
  value: string
  fontSize: number
  color: string
}

const uid = (): string => crypto.randomUUID()
const fontSizeFor = (strokeWidth: number): number => Math.max(14, strokeWidth * 5)

function normRect(r: Rect): Rect {
  return {
    x: r.width >= 0 ? r.x : r.x + r.width,
    y: r.height >= 0 ? r.y : r.y + r.height,
    width: Math.abs(r.width),
    height: Math.abs(r.height)
  }
}

function BlurShape({
  shape,
  baseEl,
  registerNode
}: {
  shape: Extract<Shape, { kind: 'blur' }>
  baseEl: HTMLImageElement | null
  registerNode: (id: string, n: Konva.Node | null) => void
}): ReactElement {
  const ref = useRef<Konva.Image>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || !baseEl) return
    node.cache({ pixelRatio: 1 })
    node.filters([Pixelate])
    node.pixelSize(Math.max(8, shape.strokeWidth * 4))
    node.getLayer()?.batchDraw()
  }, [baseEl, shape.x, shape.y, shape.width, shape.height, shape.strokeWidth])

  return (
    <KImage
      ref={(n) => registerNode(shape.id, n)}
      image={baseEl ?? undefined}
      crop={{ x: shape.x, y: shape.y, width: shape.width, height: shape.height }}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
    />
  )
}

export default function Editor(): ReactElement {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [baseEl, setBaseEl] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>(COLORS[3])
  const [strokeWidth, setStrokeWidth] = useState<number>(4)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const [area, setArea] = useState({ w: 800, h: 500 })
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  const past = useRef<Doc[]>([])
  const future = useRef<Doc[]>([])
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())
  const areaRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const drawingRef = useRef(false)
  const cropStart = useRef<Point | null>(null)

  useEffect(() => {
    void window.api.getEditorShot().then((shot) => {
      if (!shot) {
        window.close()
        return
      }
      past.current = []
      future.current = []
      setDoc({ base: shot, shapes: [] })
    })
  }, [])

  useEffect(() => {
    if (!doc) return
    const img = new Image()
    img.onload = () => setBaseEl(img)
    img.src = doc.base.dataUrl
  }, [doc])

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setArea({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setArea({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const resizableKinds = ['rect', 'ellipse', 'blur', 'text']
    const sel = selectedId ? doc?.shapes.find((s) => s.id === selectedId) : null
    const node = sel && resizableKinds.includes(sel.kind) ? nodeRefs.current.get(sel.id) : null
    tr.nodes(tool === 'select' && node ? [node] : [])
    tr.getLayer()?.batchDraw()
  })

  const showToast = (msg: string): void => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }

  const registerNode = (id: string, n: Konva.Node | null): void => {
    if (n) nodeRefs.current.set(id, n)
    else nodeRefs.current.delete(id)
  }

  const commit = (next: Doc): void => {
    if (!doc) return
    past.current.push(doc)
    future.current = []
    setDoc(next)
    rerender()
  }

  const undo = (): void => {
    if (!doc || past.current.length === 0) return
    future.current.push(doc)
    setDoc(past.current.pop() as Doc)
    setSelectedId(null)
    rerender()
  }

  const redo = (): void => {
    if (!doc || future.current.length === 0) return
    past.current.push(doc)
    setDoc(future.current.pop() as Doc)
    setSelectedId(null)
    rerender()
  }

  const deleteSelected = (): void => {
    if (!selectedId || !doc) return
    commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selectedId) })
    setSelectedId(null)
  }

  const applyCrop = (): void => {
    if (!cropRect || !baseEl || !doc) return
    const n = normRect(cropRect)
    const c = document.createElement('canvas')
    c.width = Math.round(n.width)
    c.height = Math.round(n.height)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(baseEl, Math.round(n.x), Math.round(n.y), c.width, c.height, 0, 0, c.width, c.height)
    commit({ base: { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height }, shapes: [] })
    setCropRect(null)
    setTool('select')
    setSelectedId(null)
  }

  const cancelCrop = (): void => {
    setCropRect(null)
    cropStart.current = null
  }

  const commitText = (): void => {
    if (!textDraft || !doc) return
    const t = textDraft
    setTextDraft(null)
    if (t.value.trim()) {
      commit({
        ...doc,
        shapes: [
          ...doc.shapes,
          {
            id: uid(),
            kind: 'text',
            x: t.x,
            y: t.y,
            text: t.value,
            fontSize: t.fontSize,
            color: t.color,
            strokeWidth
          }
        ]
      })
    }
  }

  const patchShape = (id: string, patch: Partial<Shape>): void => {
    if (!doc) return
    const next = doc.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s))
    past.current.push(doc)
    future.current = []
    setDoc({ ...doc, shapes: next })
    rerender()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'Escape') {
      if (textDraft) setTextDraft(null)
      else if (cropRect) cancelCrop()
      else if (selectedId) setSelectedId(null)
      else window.close()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !textDraft) {
      e.preventDefault()
      deleteSelected()
      return
    }
    if (e.key === 'Enter' && cropRect) {
      e.preventDefault()
      applyCrop()
    }
  }

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!doc) {
    return (
      <div className="editor-root empty">
        <p>Loading…</p>
      </div>
    )
  }

  const bw = doc.base.width
  const bh = doc.base.height
  const view = Math.max(0.05, Math.min(1, (area.w - 48) / bw, (area.h - 24) / bh))

  const getPt = (): Point => {
    const p = stageRef.current?.getPointerPosition() ?? { x: 0, y: 0 }
    return { x: p.x / view, y: p.y / view }
  }

  const makeDraft = (p: Point): Shape | null => {
    const common = { id: uid(), color, strokeWidth }
    switch (tool) {
      case 'rect':
        return { ...common, kind: 'rect', x: p.x, y: p.y, width: 0, height: 0 }
      case 'ellipse':
        return { ...common, kind: 'ellipse', x: p.x, y: p.y, width: 0, height: 0 }
      case 'blur':
        return { ...common, kind: 'blur', x: p.x, y: p.y, width: 0, height: 0 }
      case 'arrow':
        return { ...common, kind: 'arrow', points: [p.x, p.y, p.x, p.y] }
      case 'pen':
        return { ...common, kind: 'pen', points: [p.x, p.y] }
      default:
        return null
    }
  }

  const applyDraftMove = (s: Shape, p: Point): Shape => {
    switch (s.kind) {
      case 'rect':
      case 'ellipse':
      case 'blur':
        return { ...s, width: p.x - s.x, height: p.y - s.y }
      case 'arrow':
        return { ...s, points: [s.points[0], s.points[1], p.x, p.y] }
      case 'pen':
        return { ...s, points: [...s.points, p.x, p.y] }
      default:
        return s
    }
  }

  const finalizeDraft = (s: Shape): boolean => {
    if (s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'blur') {
      const n = normRect(s)
      if (n.width < 4 || n.height < 4) return false
      commit({
        ...doc,
        shapes: [...doc.shapes, { ...s, x: n.x, y: n.y, width: n.width, height: n.height } as Shape]
      })
      return true
    }
    if (s.kind === 'arrow') {
      if (Math.hypot(s.points[2] - s.points[0], s.points[3] - s.points[1]) < 4) return false
      commit({ ...doc, shapes: [...doc.shapes, s] })
      return true
    }
    if (s.kind === 'pen') {
      if (s.points.length < 6) return false
      commit({ ...doc, shapes: [...doc.shapes, s] })
      return true
    }
    return false
  }

  const onStageMouseDown = (e: KonvaEventObject<MouseEvent>): void => {
    if (textDraft) {
      commitText()
      return
    }
    const p = getPt()
    if (tool === 'select') {
      if (e.target !== stageRef.current) return
      setSelectedId(null)
      return
    }
    if (tool === 'crop') {
      cropStart.current = p
      setCropRect({ x: p.x, y: p.y, width: 0, height: 0 })
      return
    }
    if (tool === 'text') {
      setTextDraft({ x: p.x, y: p.y, value: '', fontSize: fontSizeFor(strokeWidth), color })
      return
    }
    if (tool === 'number') {
      const n = doc.shapes.filter((s) => s.kind === 'number').length + 1
      commit({
        ...doc,
        shapes: [...doc.shapes, { id: uid(), kind: 'number', x: p.x, y: p.y, n, color, strokeWidth }]
      })
      return
    }
    const d = makeDraft(p)
    if (d) {
      drawingRef.current = true
      setDraft(d)
    }
  }

  const onStageMouseMove = (): void => {
    if (cropStart.current) {
      const p = getPt()
      const s = cropStart.current
      setCropRect({ x: s.x, y: s.y, width: p.x - s.x, height: p.y - s.y })
      return
    }
    if (!drawingRef.current || !draft) return
    setDraft(applyDraftMove(draft, getPt()))
  }

  const onStageMouseUp = (): void => {
    if (cropStart.current) {
      cropStart.current = null
      if (cropRect) {
        const n = normRect(cropRect)
        setCropRect(n.width > 4 && n.height > 4 ? n : null)
      }
      return
    }
    if (!drawingRef.current || !draft) return
    drawingRef.current = false
    setDraft(null)
    finalizeDraft(draft)
  }

  const handleDragEnd = (s: Shape, node: Konva.Node): void => {
    switch (s.kind) {
      case 'rect':
      case 'blur':
        patchShape(s.id, { x: node.x(), y: node.y() })
        break
      case 'ellipse':
        patchShape(s.id, { x: node.x() - s.width / 2, y: node.y() - s.height / 2 })
        break
      case 'arrow':
      case 'pen': {
        const dx = node.x()
        const dy = node.y()
        node.position({ x: 0, y: 0 })
        patchShape(s.id, {
          points: s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy))
        })
        break
      }
      case 'text':
      case 'number':
        patchShape(s.id, { x: node.x(), y: node.y() })
        break
    }
  }

  const handleTransformEnd = (s: Shape, node: Konva.Node): void => {
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    switch (s.kind) {
      case 'rect':
      case 'blur': {
        const w = Math.max(6, s.width * sx)
        const h = Math.max(6, s.height * sy)
        patchShape(s.id, { x: node.x(), y: node.y(), width: w, height: h })
        break
      }
      case 'ellipse': {
        const w = Math.max(6, s.width * sx)
        const h = Math.max(6, s.height * sy)
        patchShape(s.id, { x: node.x() - w / 2, y: node.y() - h / 2, width: w, height: h })
        break
      }
      case 'text':
        patchShape(s.id, {
          x: node.x(),
          y: node.y(),
          fontSize: Math.max(10, Math.round(s.fontSize * sy))
        })
        break
      default:
        break
    }
  }

  const exportDataUrl = (): string => stageRef.current?.toDataURL({ pixelRatio: 1 / view }) ?? ''

  const doExport = async (mode: 'clipboard' | 'save'): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await window.api.exportShot({ mode, dataUrl: exportDataUrl() })
      if (res.ok) {
        if (mode === 'clipboard') {
          showToast('Copied to clipboard')
          window.setTimeout(() => window.close(), 900)
        } else {
          showToast(res.path ? `Saved: ${res.path}` : 'Saved')
          window.setTimeout(() => window.close(), 1400)
        }
      } else if (!res.canceled) {
        showToast(res.error ?? 'Export failed')
      }
    } finally {
      setBusy(false)
    }
  }

  const shapeEvents = (s: Shape) => ({
    draggable: tool === 'select',
    onClick: (e: KonvaEventObject<MouseEvent>): void => {
      if (tool !== 'select') return
      e.cancelBubble = true
      setSelectedId(s.id)
    },
    onDragEnd: (e: KonvaEventObject<DragEvent>): void => handleDragEnd(s, e.target),
    onTransformEnd: (e: KonvaEventObject<Event>): void => handleTransformEnd(s, e.target),
    ref: (n: Konva.Node | null): void => registerNode(s.id, n)
  })

  const renderShape = (s: Shape): ReactElement => {
    switch (s.kind) {
      case 'rect':
        return (
          <KRect
            key={s.id}
            {...shapeEvents(s)}
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
          />
        )
      case 'ellipse':
        return (
          <Ellipse
            key={s.id}
            {...shapeEvents(s)}
            x={s.x + s.width / 2}
            y={s.y + s.height / 2}
            radiusX={Math.abs(s.width / 2)}
            radiusY={Math.abs(s.height / 2)}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
          />
        )
      case 'number': {
        const fs = fontSizeFor(s.strokeWidth)
        const d = Math.max(26, fs * 1.7)
        return (
          <Group key={s.id} {...shapeEvents(s)} x={s.x} y={s.y}>
            <Circle
              radius={d / 2}
              fill={s.color}
              stroke={s.color === '#ffffff' ? '#334155' : '#ffffff'}
              strokeWidth={1.5}
            />
            <Text
              x={-d / 2}
              y={-fs * 0.55}
              width={d}
              align="center"
              text={String(s.n)}
              fontSize={fs}
              fontStyle="700"
              fontFamily="system-ui, sans-serif"
              fill="#ffffff"
              listening={false}
            />
          </Group>
        )
      }
      case 'blur':
        return <BlurShape key={s.id} shape={s} baseEl={baseEl} registerNode={registerNode} />
      case 'arrow':
        return (
          <Arrow
            key={s.id}
            {...shapeEvents(s)}
            points={s.points}
            stroke={s.color}
            fill={s.color}
            strokeWidth={s.strokeWidth}
            lineCap="round"
            pointerLength={s.strokeWidth * 3.2}
            pointerWidth={s.strokeWidth * 3.2}
          />
        )
      case 'pen':
        return (
          <Line
            key={s.id}
            {...shapeEvents(s)}
            points={s.points}
            stroke={s.color}
            strokeWidth={s.strokeWidth}
            tension={0.35}
            lineCap="round"
            lineJoin="round"
          />
        )
      case 'text':
        return (
          <Text
            key={s.id}
            {...shapeEvents(s)}
            x={s.x}
            y={s.y}
            text={s.text}
            fontSize={s.fontSize}
            fontStyle="600"
            fontFamily="system-ui, sans-serif"
            fill={s.color}
          />
        )
    }
  }

  const crop = cropRect ? normRect(cropRect) : null

  return (
    <div className="editor-root">
      <Toolbar
        tool={tool}
        setTool={(t) => {
          setTool(t)
          setSelectedId(null)
          setTextDraft(null)
        }}
        color={color}
        setColor={setColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onDelete={deleteSelected}
        onClear={() => commit({ ...doc, shapes: [] })}
        cropPending={!!cropRect}
        onCropApply={applyCrop}
        onCropCancel={cancelCrop}
      />

      <main className="stage-area" ref={areaRef}>
        <div className="stage-wrap" style={{ width: bw * view, height: bh * view }}>
          <Stage
            ref={stageRef}
            width={Math.round(bw * view)}
            height={Math.round(bh * view)}
            scaleX={view}
            scaleY={view}
            onMouseDown={onStageMouseDown}
            onMouseMove={onStageMouseMove}
            onMouseUp={onStageMouseUp}
          >
            <Layer listening={false}>
              <KImage image={baseEl ?? undefined} width={bw} height={bh} />
            </Layer>
            <Layer>
              {doc.shapes.map(renderShape)}
              {draft && renderShape(draft)}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                keepRatio={false}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                boundBoxFunc={(box) => ({
                  ...box,
                  width: Math.max(6, box.width),
                  height: Math.max(6, box.height)
                })}
              />
              {crop && (
                <Group>
                  <KRect x={0} y={0} width={bw} height={crop.y} fill="rgba(2,6,23,0.55)" listening={false} />
                  <KRect
                    x={0}
                    y={crop.y}
                    width={crop.x}
                    height={crop.height}
                    fill="rgba(2,6,23,0.55)"
                    listening={false}
                  />
                  <KRect
                    x={crop.x + crop.width}
                    y={crop.y}
                    width={Math.max(0, bw - crop.x - crop.width)}
                    height={crop.height}
                    fill="rgba(2,6,23,0.55)"
                    listening={false}
                  />
                  <KRect
                    x={0}
                    y={crop.y + crop.height}
                    width={bw}
                    height={Math.max(0, bh - crop.y - crop.height)}
                    fill="rgba(2,6,23,0.55)"
                    listening={false}
                  />
                  <KRect
                    x={crop.x}
                    y={crop.y}
                    width={crop.width}
                    height={crop.height}
                    stroke="#38bdf8"
                    dash={[6, 4]}
                    strokeWidth={1.5}
                    listening={false}
                  />
                </Group>
              )}
            </Layer>
          </Stage>

          {textDraft && (
            <textarea
              className="text-input"
              autoFocus
              style={{
                left: textDraft.x * view,
                top: textDraft.y * view,
                fontSize: textDraft.fontSize * view,
                color: textDraft.color
              }}
              value={textDraft.value}
              placeholder="Type…"
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onBlur={() => commitText()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitText()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setTextDraft(null)
                }
              }}
            />
          )}
        </div>
      </main>

      <footer className="footer">
        <span className="hint">
          {bw} × {bh}px
        </span>
        <button
          type="button"
          className="action primary"
          disabled={busy}
          onClick={() => void doExport('clipboard')}
        >
          Copy to clipboard
        </button>
        <button type="button" className="action" disabled={busy} onClick={() => void doExport('save')}>
          Save…
        </button>
        <button type="button" className="action ghost" disabled={busy} onClick={() => window.close()}>
          Close
        </button>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

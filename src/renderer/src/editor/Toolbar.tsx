import type { ReactElement } from 'react'
import type { ToolId } from '../../../shared/types'

export const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111827', '#ffffff']
export const STROKE_WIDTHS = [2, 4, 8]

const TOOLS: { id: ToolId; glyph: string; title: string }[] = [
  { id: 'select', glyph: '⬚', title: 'Select / move' },
  { id: 'crop', glyph: '⛶', title: 'Crop' },
  { id: 'rect', glyph: '▭', title: 'Rectangle' },
  { id: 'ellipse', glyph: '◯', title: 'Ellipse' },
  { id: 'arrow', glyph: '➔', title: 'Arrow' },
  { id: 'pen', glyph: '✎', title: 'Pen' },
  { id: 'text', glyph: 'T', title: 'Text' },
  { id: 'number', glyph: '①', title: 'Numbered marker' },
  { id: 'blur', glyph: '▒', title: 'Pixelate region' }
]

interface Props {
  tool: ToolId
  setTool: (t: ToolId) => void
  color: string
  setColor: (c: string) => void
  strokeWidth: number
  setStrokeWidth: (n: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onClear: () => void
  cropPending: boolean
  onCropApply: () => void
  onCropCancel: () => void
}

export default function Toolbar(props: Props): ReactElement {
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tb-btn${props.tool === t.id ? ' active' : ''}`}
          title={t.title}
          onClick={() => props.setTool(t.id)}
        >
          {t.glyph}
        </button>
      ))}

      <div className="tb-sep" />

      {props.cropPending ? (
        <>
          <button type="button" className="tb-btn accent" onClick={props.onCropApply} title="Apply crop (Enter)">
            ✓ Crop
          </button>
          <button type="button" className="tb-btn" onClick={props.onCropCancel} title="Cancel crop (Esc)">
            ✕
          </button>
        </>
      ) : (
        <>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${props.color === c ? ' selected' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => props.setColor(c)}
              />
            ))}
          </div>

          <div className="tb-sep" />

          <div className="widths">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`tb-btn${props.strokeWidth === w ? ' active' : ''}`}
                title={`Stroke ${w}px`}
                onClick={() => props.setStrokeWidth(w)}
              >
                <span className="width-dot" style={{ width: w + 4, height: w + 4 }} />
              </button>
            ))}
          </div>

          <div className="tb-sep" />

          <button type="button" className="tb-btn" disabled={!props.canUndo} onClick={props.onUndo} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button type="button" className="tb-btn" disabled={!props.canRedo} onClick={props.onRedo} title="Redo (Ctrl+Y)">
            ↷
          </button>
          <button type="button" className="tb-btn" onClick={props.onDelete} title="Delete selection (Del)">
            Delete
          </button>
          <button type="button" className="tb-btn" onClick={props.onClear} title="Remove all annotations">
            Clear
          </button>
        </>
      )}
    </div>
  )
}

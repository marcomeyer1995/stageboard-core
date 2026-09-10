import { useState } from 'react'
import type { BeatAnchor } from 'shared-types'
import { randomId } from '../lib/id'

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centis = Math.floor((ms % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

interface BeatAnchorListEditorProps {
  anchors: BeatAnchor[]
  onChange: (anchors: BeatAnchor[]) => void
}

/**
 * Add/edit/remove UI for a SongVariant's beat anchors (#25 follow-up) - same list shape as
 * CueListEditor.tsx (sorted-on-add, one row per entry, a plain "Entfernen" button), just
 * simpler rows: an anchor is only ever a timestamp, no capability/device/payload fields. This
 * is the manual-override surface for both authoring paths - type an exact time directly here,
 * or remove/fix up whatever `TapBeatAnchors.tsx`'s free-form tapping or the "Track analysieren"
 * auto-detection produced.
 */
export function BeatAnchorListEditor({ anchors, onChange }: BeatAnchorListEditorProps) {
  const [seconds, setSeconds] = useState(0)

  function add() {
    const anchor: BeatAnchor = { id: randomId(), timeMs: Math.round(seconds * 1000) }
    onChange([...anchors, anchor].sort((a, b) => a.timeMs - b.timeMs))
  }

  function remove(id: string) {
    onChange(anchors.filter((anchor) => anchor.id !== id))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">Klick-Anker</p>
      {anchors.length === 0 && <p className="text-xs text-ink-faint">Noch keine Anker für diese Variante.</p>}
      {anchors.map((anchor) => (
        <div
          key={anchor.id}
          className="flex items-center gap-3 rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft"
        >
          <span className="flex-1 font-sb-mono text-ink">{formatTime(anchor.timeMs)}</span>
          <button
            type="button"
            onClick={() => remove(anchor.id)}
            className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink-soft hover:bg-control-strong-hover"
          >
            Entfernen
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-sb-sm border border-dashed border-line p-3">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Zeit (s)
          <input
            type="number"
            min={0}
            step={0.01}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
            className="w-24 rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="self-end rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-accent hover:bg-control-strong-hover"
        >
          Anker hinzufügen
        </button>
      </div>
    </div>
  )
}

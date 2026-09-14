import { useState } from 'react'
import type { TempoMarker } from 'shared-types'
import { randomId } from '../lib/id'

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centis = Math.floor((ms % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

interface TempoMarkerListEditorProps {
  tempoMarkers: TempoMarker[]
  onChange: (tempoMarkers: TempoMarker[]) => void
}

/**
 * Add/edit/remove UI for a SongVariant's tempo markers (#141) - genuine mid-song tempo changes,
 * same list shape as `BeatAnchorListEditor.tsx`/`CueListEditor.tsx` (sorted-on-add, one row per
 * entry, a plain "Entfernen" button). *Where* a tempo change happens is never auto-detected (no
 * tool available here can find that reliably - see the session that produced this feature) -
 * `SheetEditor.tsx` sets a marker's `timeMs` either from this editor's own manual "Zeit (s)"
 * input, or by switching into `TapTempoMarker.tsx`'s tap-while-playing mode, exactly like
 * `TapBeatAnchors.tsx` already does for beat anchors. Once placed, its `bpm` is freely editable
 * right here - "detecting" the tempo *within* an already-bounded segment (#141 Phase 2) is a
 * separate, much more tractable problem than finding the boundary itself.
 */
export function TempoMarkerListEditor({ tempoMarkers, onChange }: TempoMarkerListEditorProps) {
  const [seconds, setSeconds] = useState(0)
  const [bpm, setBpm] = useState(120)

  function add() {
    const marker: TempoMarker = { id: randomId(), timeMs: Math.round(seconds * 1000), bpm }
    onChange([...tempoMarkers, marker].sort((a, b) => a.timeMs - b.timeMs))
  }

  function remove(id: string) {
    onChange(tempoMarkers.filter((marker) => marker.id !== id))
  }

  function setMarkerBpm(id: string, newBpm: number) {
    onChange(tempoMarkers.map((marker) => (marker.id === id ? { ...marker, bpm: newBpm } : marker)))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">Tempo-Wechsel</p>
      {tempoMarkers.length === 0 ? (
        <p className="text-xs text-ink-faint">Kein Tempo-Wechsel in dieser Variante.</p>
      ) : (
        // Capped height, not open-ended - same reasoning as BeatAnchorListEditor.tsx: a long
        // list here shouldn't push "Marker hinzufügen" further down with every addition.
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
          {tempoMarkers.map((marker) => (
            <div
              key={marker.id}
              className="flex items-center gap-3 rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft"
            >
              <span className="flex-1 font-sb-mono text-ink">{formatTime(marker.timeMs)}</span>
              <label className="flex items-center gap-1 text-xs text-ink-muted">
                BPM
                <input
                  type="number"
                  min={1}
                  value={marker.bpm}
                  onChange={(e) => setMarkerBpm(marker.id, Number(e.target.value))}
                  className="w-16 rounded-sb-sm bg-control-strong px-1 py-0.5 text-xs text-ink"
                />
              </label>
              <button
                type="button"
                onClick={() => remove(marker.id)}
                className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink-soft hover:bg-control-strong-hover"
              >
                Entfernen
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-sb-sm border border-dashed border-line p-3">
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
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          BPM
          <input
            type="number"
            min={1}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-20 rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          onClick={add}
          className="rounded-sb-sm bg-control-strong px-3 py-1 text-sm font-medium text-accent hover:bg-control-strong-hover"
        >
          Marker hinzufügen
        </button>
      </div>
    </div>
  )
}

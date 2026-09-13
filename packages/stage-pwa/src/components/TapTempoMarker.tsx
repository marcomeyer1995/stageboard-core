import { formatTrackClockTime as formatTime, useTrackClock } from '../lib/useTrackClock'
import { useClockStore } from '../store/useClockStore'

interface TapTempoMarkerProps {
  trackSrc: string | null
  onComplete: (timeMs: number) => void
  onCancel: () => void
}

/**
 * Captures a single timestamp by ear (#141) - play the track, press "Position übernehmen"
 * exactly where the tempo changes. Deliberately one-shot, unlike `TapBeatAnchors.tsx`'s
 * rapid-fire multi-tap session: a song has at most a handful of genuine tempo changes, so there's
 * no need for a dedicated tapping *session* the way there is for "every beat of the whole song."
 * `SheetEditor.tsx` turns the captured time into a new `TempoMarker` (with a starting `bpm` guess
 * the user then edits in `TempoMarkerListEditor.tsx`) and switches back to the normal view - this
 * component only ever hands back a plain number, never touches `tempoMarkers` itself.
 *
 * Reuses `useTrackClock.ts` exactly like `TapBeatAnchors.tsx` does, and for the same reason
 * they're mutually exclusive in SheetEditor.tsx (never rendered at the same time as each other):
 * `useTrackClock` drives the single shared Master-Clock (`useClockStore.ts`) via this component's
 * own `<audio>` element - two instances mounted at once would fight over the same clock.
 */
export function TapTempoMarker({ trackSrc, onComplete, onCancel }: TapTempoMarkerProps) {
  const { elapsedMs, isPlaying, duration, position, togglePlay, audioProps } = useTrackClock(trackSrc)

  function capture() {
    onComplete(Math.round(useClockStore.getState().getElapsedMs()))
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft">
        <span>Spiel den Track ab und drücke "Position übernehmen" genau dort, wo sich das Tempo ändert.</span>
        <span className="font-sb-mono text-ink">{(elapsedMs / 1000).toFixed(2)}s</span>
      </div>
      <div className="flex items-center gap-2 rounded-sb-sm bg-control px-3 py-2 text-xs text-ink-soft">
        <audio {...audioProps} />
        <button
          type="button"
          onClick={togglePlay}
          className="rounded-sb-sm bg-control-strong px-3 py-1 font-medium text-ink hover:bg-control-strong-hover"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <span className="font-sb-mono">
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={capture}
          className="flex-1 rounded-sb-sm bg-accent-2 py-3 text-lg font-bold text-accent-ink hover:bg-accent-2-hover"
        >
          Position übernehmen
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sb-sm bg-control-strong px-4 py-3 text-sm hover:bg-control-strong-hover"
        >
          Abbrechen
        </button>
      </div>
    </div>
  )
}

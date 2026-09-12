import { useEffect, useRef, useState } from 'react'
import type { BeatAnchor } from 'shared-types'
import { randomId } from '../lib/id'
import { beatsPerBar } from '../lib/metronome'
import { formatTrackClockTime as formatTime, useTrackClock } from '../lib/useTrackClock'
import { useClockStore } from '../store/useClockStore'

interface TapBeatAnchorsProps {
  trackSrc: string | null
  timeSignature: string
  onComplete: (anchors: BeatAnchor[]) => void
  onCancel: () => void
}

/**
 * Free-form manual sync-point authoring for beat anchors (#25 follow-up) - unlike TapToSync.tsx's
 * line-by-line walk through a fixed set of ChordPro lines, there's no list to advance through
 * here: every tap (Space key or the on-screen button) just appends a new anchor at the current
 * playback position and keeps playing, so a musician can play through a whole song and tap
 * wherever a resync point is actually needed (once near the top for the lead-in, again after a
 * tricky bridge, ...) - as many or as few as the song needs. Reuses useTrackClock.ts (extracted
 * from TapToSync.tsx) for the same audio-element-driven Master-Clock wiring; no bare-stopwatch
 * fallback here unlike TapToSync's line-tapping - there's nothing to tap a *downbeat* against
 * without real audio, so this is never rendered without a track (SheetEditor.tsx disables the
 * button that opens it whenever `!tapTrack`).
 */
export function TapBeatAnchors({ trackSrc, timeSignature, onComplete, onCancel }: TapBeatAnchorsProps) {
  const { elapsedMs, isPlaying, duration, position, togglePlay, audioProps } = useTrackClock(trackSrc)
  // A ref, not state, for the accumulated list itself - it doesn't need to trigger a re-render
  // on every tap (tapCount below does that for the visible counter), and keeping it out of
  // state means the keydown handler's `tap` closure never needs re-binding as the list grows.
  const anchorsRef = useRef<BeatAnchor[]>([])
  const [tapCount, setTapCount] = useState(0)

  function tap() {
    const ms = useClockStore.getState().getElapsedMs()
    // Sequential 0,1,2,3,0,1,... assuming this tapping session's first tap is beat 1 - the same
    // starting assumption automatic detection makes (see audioAnalysis.ts's detectBeatAnchors
    // doc comment), correctable afterward via BeatAnchorListEditor's "Beat" selector if a tap was
    // skipped or the session didn't actually start on the downbeat.
    const beatInBar = anchorsRef.current.length % beatsPerBar(timeSignature)
    anchorsRef.current.push({ id: randomId(), timeMs: Math.round(ms), beatInBar })
    setTapCount(anchorsRef.current.length)
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault()
        // Holding the key even briefly - very natural while tapping along to a beat - fires
        // repeated keydown events (e.repeat) at the OS's key-repeat rate, tens of ms apart.
        // Without this guard each repeat appended its own near-duplicate anchor (found live,
        // 2026-09-10: pairs of anchors 28-300ms apart scattered through an otherwise ~2-4s
        // tapping cadence), which resolveBeatGrid's correctionRatio then "corrects" into an
        // extremely fast beat dividing that near-zero gap - audible as jitter/a duplicated
        // click, not a scheduling bug in the click engine itself.
        if (e.repeat) return
        tap()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft">
        <span>
          Spiel den Track ab und drücke <kbd className="rounded-sb-sm bg-control-strong px-1.5 py-0.5 font-sb-mono">Leertaste</kbd>{' '}
          oder "Anker setzen" auf jedem Beat, an dem der Klick sich neu einordnen soll.
        </span>
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
      <p className="text-sm text-ink-muted">{tapCount === 0 ? 'Noch kein Anker gesetzt.' : `${tapCount} Anker gesetzt.`}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={tap}
          className="flex-1 rounded-sb-sm bg-accent-2 py-3 text-lg font-bold text-accent-ink hover:bg-accent-2-hover"
        >
          Anker setzen
        </button>
        <button
          type="button"
          onClick={() => onComplete(anchorsRef.current)}
          className="rounded-sb-sm bg-control-strong px-4 py-3 text-sm hover:bg-control-strong-hover"
        >
          Fertig
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

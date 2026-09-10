import { useEffect, useState } from 'react'
import { parsePartDirective, setLineTimeTag } from '../lib/chordpro'
import { formatTrackClockTime as formatTime, useTrackClock } from '../lib/useTrackClock'
import { useClockStore } from '../store/useClockStore'

/** Blank lines and part directives (`{part: Chorus}`) carry no lyrics, so they get no timecode. */
function isTappable(line: string): boolean {
  return line.trim().length > 0 && parsePartDirective(line) === null
}

interface TapToSyncProps {
  content: string
  /** Object URL for the variant's chosen track (band-mix, else reference) - null when no
   * track is attached, in which case tapping falls back to a bare stopwatch. */
  trackSrc: string | null
  onComplete: (content: string) => void
  onCancel: () => void
}

/**
 * Recording mode for docs/04's "Tap-to-Sync" workflow: tap once per line, in time with the
 * song. With a real track attached, the Master-Clock is driven by that audio's actual
 * playback position - mirrors BackingTrackPlayerWidget's onPlay/onPause/onTimeUpdate/onSeeked
 * handlers verbatim, so tapped timestamps land on the real recording instead of a
 * hand-started stopwatch that drifts from it. Without a track, it falls back to the original
 * bare-stopwatch behavior (e.g. syncing to a click only in your head).
 */
export function TapToSync({ content, trackSrc, onComplete, onCancel }: TapToSyncProps) {
  const [lines, setLines] = useState<string[]>(() => content.split('\n'))
  const [tapIndex, setTapIndex] = useState(() => lines.findIndex(isTappable))
  const { elapsedMs, isPlaying, duration, position, togglePlay, audioProps } = useTrackClock(trackSrc)

  function tap() {
    if (tapIndex < 0) return
    const ms = useClockStore.getState().getElapsedMs()
    const updated = [...lines]
    updated[tapIndex] = setLineTimeTag(updated[tapIndex], ms)
    const nextIndex = updated.findIndex((line, i) => i > tapIndex && isTappable(line))
    setLines(updated)
    if (nextIndex === -1) {
      onComplete(updated.join('\n'))
    } else {
      setTapIndex(nextIndex)
    }
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault()
        // Holding the key briefly fires repeated keydown events (e.repeat) at the OS's
        // key-repeat rate - without this guard each repeat rapid-fires through several lines
        // at once, tens of ms apart (see the identical fix in TapBeatAnchors.tsx).
        if (e.repeat) return
        tap()
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, tapIndex])

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between rounded-sb-sm bg-control px-3 py-2 text-sm text-ink-soft">
        <span>
          Drücke <kbd className="rounded-sb-sm bg-control-strong px-1.5 py-0.5 font-sb-mono">Leertaste</kbd>{' '}
          oder klicke "Tap" im Takt jeder Zeile.
        </span>
        <span className="font-sb-mono text-ink">{(elapsedMs / 1000).toFixed(2)}s</span>
      </div>
      {trackSrc && (
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
      )}
      <div className="flex-1 space-y-1 overflow-y-auto rounded-sb-sm bg-control p-3 font-sb-mono text-sm">
        {lines.map((line, i) => (
          <p
            key={i}
            className={`rounded-sb-sm px-2 py-1 ${
              i === tapIndex ? 'bg-accent-2/30 text-ink' : 'text-ink-muted'
            }`}
          >
            {line || ' '}
          </p>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={tap}
          disabled={tapIndex < 0}
          className="flex-1 rounded-sb-sm bg-accent-2 py-3 text-lg font-bold text-accent-ink hover:bg-accent-2-hover disabled:opacity-40"
        >
          Tap
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

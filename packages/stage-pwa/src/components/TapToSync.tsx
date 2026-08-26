import { useEffect, useRef, useState } from 'react'
import { parsePartDirective, setLineTimeTag } from '../lib/chordpro'
import { useElapsedMs } from '../lib/useElapsedMs'
import { useClockStore } from '../store/useClockStore'

/** Blank lines and part directives (`{part: Chorus}`) carry no lyrics, so they get no timecode. */
function isTappable(line: string): boolean {
  return line.trim().length > 0 && parsePartDirective(line) === null
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
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
  const elapsedMs = useElapsedMs()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)

  useEffect(() => {
    useClockStore.getState().reset()
    // Without a track there's no audio to press play on - keep the original
    // start-immediately stopwatch behavior so tapping still works.
    if (!trackSrc) useClockStore.getState().start()
    return () => {
      useClockStore.getState().stop()
    }
  }, [trackSrc])

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

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    // play() returns a promise that rejects with AbortError if pause() interrupts it before
    // it resolves (e.g. a quick double-tap) - expected, not a bug.
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault()
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
          <audio
            ref={audioRef}
            src={trackSrc}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onPlay={() => {
              setIsPlaying(true)
              useClockStore.getState().start()
            }}
            onPause={() => {
              setIsPlaying(false)
              useClockStore.getState().stop()
            }}
            onEnded={() => {
              setIsPlaying(false)
              useClockStore.getState().stop()
            }}
            onTimeUpdate={(e) => {
              setPosition(e.currentTarget.currentTime)
              useClockStore.getState().seek(e.currentTarget.currentTime * 1000)
            }}
            onSeeked={(e) => useClockStore.getState().seek(e.currentTarget.currentTime * 1000)}
          />
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

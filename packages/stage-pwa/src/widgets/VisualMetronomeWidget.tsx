import { beatAt } from '../lib/metronome'
import { useShowMode } from '../lib/showMode'

/** How long each beat's flash stays visible, in ms - short enough to read as a pulse rather
 * than a slow color swap, comfortably visible even at fast tempos (at 200 BPM a beat is only
 * 300ms long). */
const PULSE_WINDOW_MS = 90

/**
 * A dashboard widget that pulses on every beat of the active song, driven by the same synced
 * elapsed-playback clock the Prompter uses (usePlaybackElapsedMs.ts/usePracticeElapsedMs.ts
 * via useShowMode()) rather than a local setInterval - so a drummer watching this on their own
 * tablet sees the exact same beat every other tablet in the workspace does (#25's visual half;
 * the audio click generator and hardware routing are deliberately out of scope here, split to
 * a follow-up issue since they need real output hardware to verify meaningfully).
 */
export function VisualMetronomeWidget() {
  const { queue, elapsedMs, playbackStatus } = useShowMode()
  const song = queue.currentVariant ?? queue.currentSong

  if (!song) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-sb bg-surface text-ink-soft">
        <span className="text-sm">Kein Song aktiv</span>
      </div>
    )
  }

  if (playbackStatus !== 'playing' || elapsedMs === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-sb bg-surface text-ink-soft">
        <span className="text-sm">Wartet auf Play</span>
        <span className="text-xs opacity-70 tabular-nums">
          {song.bpm} BPM · {song.timeSignature}
        </span>
      </div>
    )
  }

  const beat = beatAt(elapsedMs, song.bpm, song.timeSignature)
  const pulseOn = beat.msIntoBeat < PULSE_WINDOW_MS

  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-1 rounded-sb transition-colors duration-75 ${
        pulseOn ? (beat.isDownbeat ? 'bg-accent text-surface' : 'bg-ink text-surface') : 'bg-surface text-ink'
      }`}
    >
      <span className="text-4xl font-bold tabular-nums">{beat.beatInBar + 1}</span>
      <span className="text-xs opacity-70 tabular-nums">
        {song.bpm} BPM · {song.timeSignature}
      </span>
    </div>
  )
}

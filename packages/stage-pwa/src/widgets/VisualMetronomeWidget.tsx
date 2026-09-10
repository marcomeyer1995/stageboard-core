import { adjustedBpm, type Beat, beatAt, beatsPerBar } from '../lib/metronome'
import { useShowMode } from '../lib/showMode'
import { type MetronomeConfig } from './metronomeConfig'

/** How long each beat's flash stays visible, in ms - short enough to read as a pulse rather
 * than a slow color swap, comfortably visible even at fast tempos (at 200 BPM a beat is only
 * 300ms long). */
const PULSE_WINDOW_MS = 90

function BeatDots({ beat, totalBeats }: { beat: Beat; totalBeats: number }) {
  const flashOn = beat.msIntoBeat < PULSE_WINDOW_MS
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: totalBeats }, (_, i) => {
        const isDownbeat = i === 0
        const isCurrent = i === beat.beatInBar && flashOn
        return (
          <span
            key={i}
            className={`rounded-full transition-colors duration-75 ${isDownbeat ? 'h-4 w-4' : 'h-3 w-3'} ${
              isCurrent ? (beat.isCountIn ? 'bg-ink-muted' : isDownbeat ? 'bg-accent' : 'bg-ink') : 'bg-control-strong'
            }`}
          />
        )
      })}
    </div>
  )
}

/**
 * A dashboard widget that pulses on every beat of the active song, driven by the same synced
 * elapsed-playback clock the Prompter uses (usePlaybackElapsedMs.ts/usePracticeElapsedMs.ts
 * via useShowMode()) rather than a local setInterval - so a drummer watching this on their own
 * tablet sees the exact same beat every other tablet in the workspace does (#25's visual half;
 * the audio click generator and hardware routing are deliberately out of scope here, split to
 * a follow-up issue since they need real output hardware to verify meaningfully).
 */
export function VisualMetronomeWidget({ config }: { config: MetronomeConfig }) {
  const { queue, elapsedMs, playbackStatus, liveTempoAdjustPercent } = useShowMode()
  const song = queue.currentVariant ?? queue.currentSong
  const countInBars = queue.currentVariant?.countInEnabled ? (queue.currentVariant.countInBars ?? 0) : 0

  if (!song) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-sb bg-surface text-ink-soft">
        <span className="text-sm">Kein Song aktiv</span>
      </div>
    )
  }

  const bpm = adjustedBpm(song.bpm, liveTempoAdjustPercent)
  const bpmLabel =
    liveTempoAdjustPercent === 0
      ? `${song.bpm} BPM`
      : `${Math.round(bpm)} BPM (${liveTempoAdjustPercent > 0 ? '+' : ''}${liveTempoAdjustPercent}%)`

  // beatAnchors (#25 follow-up) only lives on SongVariant, not the bare Song fallback `song`
  // itself might be - same "no variant means no anchors" shape useClickOutputDriver.ts uses.
  const beat =
    playbackStatus === 'playing' && elapsedMs !== null
      ? beatAt(elapsedMs, bpm, song.timeSignature, queue.currentVariant?.beatAnchors ?? [], countInBars)
      : null

  if (beat === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-sb bg-surface text-ink-soft">
        {/* Not playing at all, vs. playing but still before the first beat anchor (a count-in) -
            both read as "nothing to pulse yet" but are worth distinguishing in the label. */}
        <span className="text-sm">{playbackStatus === 'playing' ? 'Einzählen…' : 'Wartet auf Play'}</span>
        <span className="text-xs opacity-70 tabular-nums">
          {bpmLabel} · {song.timeSignature}
        </span>
      </div>
    )
  }

  const pulseOn = beat.msIntoBeat < PULSE_WINDOW_MS

  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-2 rounded-sb transition-colors duration-75 ${
        config.style === 'number' && pulseOn
          ? beat.isCountIn
            ? 'bg-control-strong text-ink'
            : beat.isDownbeat
              ? 'bg-accent text-surface'
              : 'bg-ink text-surface'
          : 'bg-surface text-ink'
      }`}
    >
      {/* Count-in bars (#25 follow-up) share the same pulsing display as the real song, so the
          band can still count along - this badge is the only thing marking it as lead-in, not
          the song's actual first bar. */}
      {beat.isCountIn && <span className="text-xs uppercase tracking-wide text-ink-muted">Einzählen…</span>}
      {config.style === 'beat-dots' ? (
        <BeatDots beat={beat} totalBeats={beatsPerBar(song.timeSignature)} />
      ) : (
        <span className="text-4xl font-bold tabular-nums">{beat.beatInBar + 1}</span>
      )}
      <span className="text-xs opacity-70 tabular-nums">
        {bpmLabel} · {song.timeSignature}
      </span>
    </div>
  )
}

export function MetronomeConfigPanel({
  config,
  onChange,
}: {
  config: MetronomeConfig
  onChange: (next: MetronomeConfig) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      Anzeige
      <select
        className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
        value={config.style}
        onChange={(e) => onChange({ ...config, style: e.target.value as MetronomeConfig['style'] })}
      >
        <option value="number">Zahl (Beat im Takt)</option>
        <option value="beat-dots">Punkte (Taktposition)</option>
      </select>
    </label>
  )
}

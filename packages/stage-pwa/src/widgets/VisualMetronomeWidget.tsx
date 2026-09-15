import { adjustedBpm, type Beat, beatAt, beatsPerBar } from '../lib/metronome'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type MetronomeConfig } from './metronomeConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

/** How long each beat's flash stays visible, in ms - short enough to read as a pulse rather
 * than a slow color swap, comfortably visible even at fast tempos (at 200 BPM a beat is only
 * 300ms long). */
const PULSE_WINDOW_MS = 90

function BeatDots({ beat, totalBeats }: { beat: Beat; totalBeats: number }) {
  const flashOn = beat.msIntoBeat < PULSE_WINDOW_MS
  return (
    <div className="flex items-center gap-[5cqmin]">
      {Array.from({ length: totalBeats }, (_, i) => {
        const isDownbeat = i === 0
        const isCurrent = i === beat.beatInBar && flashOn
        return (
          <span
            key={i}
            className={`rounded-full transition-colors duration-75 ${isDownbeat ? 'h-[22cqmin] w-[22cqmin]' : 'h-[16cqmin] w-[16cqmin]'} ${
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

  // The primary label (song-less placeholder, "Wartet auf Play"/"Einzählen…", or the big beat
  // number) is sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14).
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

  if (!song) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 rounded-sb bg-surface text-ink-soft">
        <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
          <span style={{ fontSize }} className="whitespace-nowrap">
            Kein Song aktiv
          </span>
        </div>
      </div>
    )
  }

  const bpm = adjustedBpm(song.bpm, liveTempoAdjustPercent)

  // beatAnchors (#25 follow-up) and tempoMarkers (#141) only live on SongVariant, not the bare
  // Song fallback `song` itself might be - same "no variant means none" shape
  // useClickOutputDriver.ts uses.
  const beat =
    playbackStatus === 'playing' && elapsedMs !== null
      ? beatAt(
          elapsedMs,
          bpm,
          song.timeSignature,
          queue.currentVariant?.beatAnchors ?? [],
          countInBars,
          queue.currentVariant?.tempoMarkers ?? [],
        )
      : null

  // The actually-audible tempo right now, not the song's authored bpm - `beat.effectiveBpm`
  // (metronome.ts, #25 follow-up) already bakes in whatever anchor-segment correction is active;
  // with no active beat (not playing yet, or still before the count-in window) there's no grid
  // to correct against, so this just falls back to the plain (live-nudged) bpm. Always shown to
  // one decimal - a rounded integer hid the whole point of the correction (Marco, 2026-09-10).
  const displayBpm = beat === null ? bpm : beat.effectiveBpm
  const bpmLabel =
    liveTempoAdjustPercent === 0
      ? `${displayBpm.toFixed(1)} BPM`
      : `${displayBpm.toFixed(1)} BPM (${liveTempoAdjustPercent > 0 ? '+' : ''}${liveTempoAdjustPercent}%)`

  if (beat === null) {
    return (
      <div className="flex h-full flex-col items-center gap-1 rounded-sb bg-surface text-ink-soft">
        {/* Not playing at all, vs. playing but still before the first beat anchor (a count-in) -
            both read as "nothing to pulse yet" but are worth distinguishing in the label. */}
        <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
          <span style={{ fontSize }} className="whitespace-nowrap font-semibold">
            {playbackStatus === 'playing' ? 'Einzählen…' : 'Wartet auf Play'}
          </span>
        </div>
        <span className="text-xs opacity-70 tabular-nums">
          {bpmLabel} · {song.timeSignature}
        </span>
      </div>
    )
  }

  const pulseOn = beat.msIntoBeat < PULSE_WINDOW_MS

  return (
    <div
      className={`flex h-full flex-col items-center gap-1 rounded-sb transition-colors duration-75 [container-type:size] ${
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
        <div className="flex w-full flex-1 items-center justify-center">
          <BeatDots beat={beat} totalBeats={beatsPerBar(song.timeSignature)} />
        </div>
      ) : (
        <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
          <span style={{ fontSize }} className="whitespace-nowrap font-bold tabular-nums leading-none">
            {beat.beatInBar + 1}
          </span>
        </div>
      )}
      <span className="text-xs opacity-70 tabular-nums">
        {bpmLabel} · {song.timeSignature}
      </span>
    </div>
  )
}

/**
 * Static stand-in for the Widget Gallery (#22) - the real component only pulses while a song
 * is actually playing (`useShowMode()`), which is almost never true while someone is sitting
 * in Edit Mode browsing widgets to add. Shows the downbeat-pulse state (config's `number`
 * style) so the tile reads as "this flashes on the beat", not the misleadingly static
 * "Wartet auf Play" idle state the real widget would otherwise show here.
 */
export function VisualMetronomeWidgetPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-sb bg-accent text-surface">
      <span className="text-4xl font-bold tabular-nums">1</span>
      <span className="text-xs opacity-70 tabular-nums">120.0 BPM · 4/4</span>
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
    <div className="flex flex-col gap-3">
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
      <SizeRatioSlider
        label="Größe"
        ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
        onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
      />
    </div>
  )
}

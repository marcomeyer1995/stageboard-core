import { computeFestivalClock } from '../lib/festivalClock'
import { useShowElapsed, useShowMode } from '../lib/showMode'
import { festivalClockLayout } from '../lib/stageWidgetLayout'
import { useElementSize } from '../lib/useElementSize'
import { useNow } from '../lib/useNow'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type FestivalClockConfig } from './festivalClockConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function formatMinutes(ms: number): string {
  return `${Math.max(1, Math.ceil(Math.abs(ms) / 60000))} min`
}

/**
 * Festival Clock (#28): the predicted end of the rest of the setlist, against the setlist's
 * target end time (set in the setlist detail). Turns red once the prediction runs past it.
 * Works in Gig and Solo Üben alike through useShowMode - the setlist is whichever is active in
 * the current mode.
 *
 * The time never shrinks; when the tile is short the caption and then the estimate note give
 * way (stageWidgetLayout.ts), and the remaining lines are single-line.
 */
export function FestivalClockWidget({ config }: { config: FestivalClockConfig }) {
  const { queue, playbackStatus, clickExtendMs, trackOverride } = useShowMode()
  // Whole seconds are plenty for an end time in minutes - one render a second, not 60 (#457).
  const elapsedMs = useShowElapsed((ms) => (ms === null ? null : Math.floor(ms / 1000) * 1000))
  const now = useNow(1000)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))
  const [boxRef, box] = useElementSize()
  const { showCaption, showEstimate } = festivalClockLayout(box.height, fontSize)

  if (queue.orderedItems.length === 0) {
    return <div className="flex h-full items-center justify-center text-ink-faint">Keine Songs vorhanden</div>
  }

  const result = computeFestivalClock({
    items: queue.orderedItems,
    currentEntryId: queue.currentEntry?.id ?? null,
    playbackStatus,
    elapsedMs,
    now,
    clickExtendMs,
    trackOverrideId: trackOverride,
    setlist: queue.activeSetlist,
  })
  const overtime = result.overrunMs !== null && result.overrunMs > 0

  return (
    <div ref={boxRef} className="flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden text-center">
      {showCaption && (
        <span className="max-w-full truncate text-xs font-bold uppercase tracking-widest text-ink-faint">
          Voraussichtliches Ende
        </span>
      )}
      <span
        style={{ fontSize }}
        className={`whitespace-nowrap font-bold tabular-nums ${overtime ? 'text-danger' : 'text-ink'}`}
      >
        {formatTime(result.predictedEnd)}
      </span>
      {result.targetEnd !== null && result.overrunMs !== null ? (
        <span className={`max-w-full truncate text-sm font-semibold ${overtime ? 'text-danger' : 'text-ok'}`}>
          Ziel {formatTime(result.targetEnd)} ·{' '}
          {overtime ? `${formatMinutes(result.overrunMs)} Überzug` : `${formatMinutes(result.overrunMs)} Puffer`}
        </span>
      ) : (
        <span className="max-w-full truncate text-xs text-ink-faint">Ziel-Ende in der Setlist setzen</span>
      )}
      {showEstimate && result.estimatedSongs > 0 && (
        <span className="max-w-full truncate text-xs text-ink-faint">
          {result.estimatedSongs} {result.estimatedSongs === 1 ? 'Song' : 'Songs'} geschätzt (Länge unbekannt)
        </span>
      )}
    </div>
  )
}

export function FestivalClockConfigPanel({
  config,
  onChange,
}: {
  config: FestivalClockConfig
  onChange: (next: FestivalClockConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}

/** Static stand-in for the Widget Gallery - the real widget needs an active setlist. */
export function FestivalClockWidgetPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">Voraussichtliches Ende</span>
      <span className="text-3xl font-bold tabular-nums text-danger">23:05</span>
      <span className="text-sm font-semibold text-danger">Ziel 23:00 · 5 min Überzug</span>
    </div>
  )
}

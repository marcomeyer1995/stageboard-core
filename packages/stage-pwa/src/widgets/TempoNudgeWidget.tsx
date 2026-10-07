import { LIVE_TEMPO_ADJUST_LIMIT_PERCENT } from '../lib/metronome'
import { useShowMode } from '../lib/showMode'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type TempoNudgeConfig } from './tempoNudgeConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'
import { READOUT_MIN, tempoLayout } from '../lib/gigWidgetLayout'
import { useElementSize } from '../lib/useElementSize'
import { Icon } from '../components/Icon'

/** Step size per tap - fine enough to correct real drift without overshooting, coarse enough
 * that reaching the +/-15% limit doesn't take a dozen taps. */
const STEP_PERCENT = 1

/**
 * A live, Master-gated +/- correction on top of the current song's bpm (#140) - for when the
 * band is audibly dragging or rushing and needs the click/metronome to follow, without
 * touching the song's own stored tempo. Gig mode only: Practice mode's tempo control is #61's
 * Speed Trainer's job (a deliberate practice choice), not a live-drift correction, so this
 * widget explains itself away there rather than offering a control that would do nothing.
 *
 * The percent readout is sized as a ratio of the device-wide default, not auto-fit to the
 * tile (Marco, 2026-09-14).
 */
export function TempoNudgeWidget({ config }: { config: TempoNudgeConfig }) {
  const { mode, liveTempoAdjustPercent, setLiveTempoAdjustPercent, nudgeLiveTempoAdjustPercent, canControl } =
    useShowMode()
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  // Before any early return - hooks must run in the same order on every render.
  const [boxRef, box] = useElementSize()

  if (mode !== 'gig') {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Nur im Gig-Modus verfügbar
      </div>
    )
  }

  const atMin = liveTempoAdjustPercent <= -LIVE_TEMPO_ADJUST_LIMIT_PERCENT
  const atMax = liveTempoAdjustPercent >= LIVE_TEMPO_ADJUST_LIMIT_PERCENT

  const valueFontSize = Math.max(READOUT_MIN, fontSize)
  const layout = tempoLayout(box.height)
  const value = `${liveTempoAdjustPercent > 0 ? '+' : ''}${liveTempoAdjustPercent}%`
  // Buttons as tall as the row allows and 30% of the width each (at least the touch size,
  // at most 96px wide), so a bigger widget means bigger - / + targets without squeezing the
  // value out of a narrow one (lib/gigWidgetLayout.ts).
  const stepClass =
    'h-full min-h-touch w-[30%] min-w-touch max-w-[96px] flex-none rounded-control bg-control-strong text-3xl font-bold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div ref={boxRef} className="flex h-full flex-col items-center gap-2 text-ink-soft">
      {layout.showLabel && <span className="flex-none text-xs uppercase tracking-widest text-ink-faint">Tempo-Korrektur</span>}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Tempo verringern"
          disabled={!canControl || atMin}
          onClick={() => nudgeLiveTempoAdjustPercent(-STEP_PERCENT)}
          className={stepClass}
        >
          −
        </button>
        {/* Without room for a separate reset button, the value itself resets (with a hint). */}
        {!layout.resetAsButton && liveTempoAdjustPercent !== 0 ? (
          <button
            type="button"
            title="Auf 0 % zurücksetzen"
            disabled={!canControl}
            onClick={() => setLiveTempoAdjustPercent(0)}
            style={{ fontSize: valueFontSize }}
            className="flex h-full min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden whitespace-nowrap font-bold tabular-nums text-accent disabled:cursor-not-allowed"
          >
            {value}
            <Icon name="reset" size="max(var(--sb-text-min), 0.5em)" />
          </button>
        ) : (
          <div className="flex h-full min-w-0 flex-1 items-center justify-center overflow-hidden">
            <span style={{ fontSize: valueFontSize }} className="whitespace-nowrap font-bold tabular-nums">
              {value}
            </span>
          </div>
        )}
        <button
          type="button"
          aria-label="Tempo erhöhen"
          disabled={!canControl || atMax}
          onClick={() => nudgeLiveTempoAdjustPercent(STEP_PERCENT)}
          className={stepClass}
        >
          +
        </button>
      </div>
      {layout.resetAsButton && liveTempoAdjustPercent !== 0 && (
        <button
          type="button"
          disabled={!canControl}
          onClick={() => setLiveTempoAdjustPercent(0)}
          className="h-form flex-none rounded-control bg-control-strong px-4 font-semibold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Zurücksetzen
        </button>
      )}
    </div>
  )
}

export function TempoNudgeConfigPanel({
  config,
  onChange,
}: {
  config: TempoNudgeConfig
  onChange: (next: TempoNudgeConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}

import { LIVE_TEMPO_ADJUST_LIMIT_PERCENT } from '../lib/metronome'
import { useShowMode } from '../lib/showMode'

/** Step size per tap - fine enough to correct real drift without overshooting, coarse enough
 * that reaching the +/-15% limit doesn't take a dozen taps. */
const STEP_PERCENT = 1

/**
 * A live, Master-gated +/- correction on top of the current song's bpm (#140) - for when the
 * band is audibly dragging or rushing and needs the click/metronome to follow, without
 * touching the song's own stored tempo. Gig mode only: Practice mode's tempo control is #61's
 * Speed Trainer's job (a deliberate practice choice), not a live-drift correction, so this
 * widget explains itself away there rather than offering a control that would do nothing.
 */
export function TempoNudgeWidget() {
  const { mode, liveTempoAdjustPercent, setLiveTempoAdjustPercent, canControl } = useShowMode()

  if (mode !== 'gig') {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Nur im Gig-Modus verfügbar
      </div>
    )
  }

  const atMin = liveTempoAdjustPercent <= -LIVE_TEMPO_ADJUST_LIMIT_PERCENT
  const atMax = liveTempoAdjustPercent >= LIVE_TEMPO_ADJUST_LIMIT_PERCENT

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-soft">
      <span className="text-xs uppercase tracking-widest text-ink-faint">Tempo-Korrektur</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canControl || atMin}
          onClick={() => setLiveTempoAdjustPercent(liveTempoAdjustPercent - STEP_PERCENT)}
          className="h-9 w-9 rounded-sb-sm bg-control-strong text-lg font-bold text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span className="w-16 text-center text-xl font-bold tabular-nums">
          {liveTempoAdjustPercent > 0 ? '+' : ''}
          {liveTempoAdjustPercent}%
        </span>
        <button
          type="button"
          disabled={!canControl || atMax}
          onClick={() => setLiveTempoAdjustPercent(liveTempoAdjustPercent + STEP_PERCENT)}
          className="h-9 w-9 rounded-sb-sm bg-control-strong text-lg font-bold text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
      {liveTempoAdjustPercent !== 0 && (
        <button
          type="button"
          disabled={!canControl}
          onClick={() => setLiveTempoAdjustPercent(0)}
          className="text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          Zurücksetzen
        </button>
      )}
    </div>
  )
}

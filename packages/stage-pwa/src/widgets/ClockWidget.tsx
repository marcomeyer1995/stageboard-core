import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
import { useNow } from '../lib/useNow'

/** A prominent wall-clock readout for stage timing (#23) - unlike SyncCheckWidget's
 * server-synced flash, this is plain local time, the same clock the venue's own wall
 * clock shows. */
export function ClockWidget() {
  const now = useNow(1000)
  // Not keyed on `now`: the clock's digit count is constant (HH:MM:SS), so re-fitting on
  // every tick would be wasted work, not a real size change. Chosen over cq units/discrete
  // tiers after Marco compared all three live (2026-09-14, see the widget-font-autofit
  // memory).
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 16, max: 200 },
    [],
  )

  return (
    <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-hidden text-center">
      <span ref={textRef} style={{ fontSize }} className="whitespace-nowrap font-bold tabular-nums text-ink">
        {new Date(now).toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  )
}

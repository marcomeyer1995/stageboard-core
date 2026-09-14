import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
import { useShowMode } from '../lib/showMode'

/**
 * Swaps which track of the current variant plays, on top of the setlist's own lasting default
 * (SetlistEntry.trackId) - not solo-practice-only, despite living next to ShowTransportWidget's
 * Practice-mode audio: e.g. tonight's second guitarist couldn't make it, so the shared PA feed
 * needs the "1 guitar" mix instead of the setlist's usual "no guitar" one, and this is the
 * fastest way to swap it for just this show without editing the setlist itself. In Gig mode
 * that write is Master-gated and shared (ShowState.trackOverride, everyone hears the same
 * feed); in Practice mode it's a purely personal, local choice (only this device's speakers
 * are affected) - see useShowMode.ts.
 */
export function TrackOverrideWidget() {
  const { queue, trackOverride, canControl, setTrackOverride } = useShowMode()
  const { currentVariant } = queue
  // Fits the caption ("Track für ...") - a native <select>'s own rendering isn't reliably
  // measurable the way plain text is, so the <select> just reuses this same computed size
  // rather than being auto-fit independently. Chosen over cq units/discrete tiers after
  // Marco compared all three live (2026-09-14, see the widget-font-autofit memory).
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 10, max: 32 },
    [currentVariant?.id],
  )

  if (!currentVariant || currentVariant.tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Kein Track angehängt
      </div>
    )
  }

  if (currentVariant.tracks.length < 2) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-faint">
        Nur ein Track vorhanden - kein Wechsel nötig
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col justify-center gap-2 text-ink-soft">
      <div ref={containerRef} className="w-full overflow-hidden">
        <span ref={textRef} style={{ fontSize }} className="block truncate uppercase tracking-widest text-ink-faint">
          Track für „{currentVariant.label}"
        </span>
      </div>
      <select
        value={trackOverride ?? ''}
        disabled={!canControl}
        onChange={(e) => setTrackOverride(e.target.value || null)}
        style={{ fontSize }}
        className="rounded-sb-sm bg-control px-2 py-1 text-ink disabled:opacity-40"
      >
        <option value="">Standard (Setlist)</option>
        {currentVariant.tracks.map((track) => (
          <option key={track.id} value={track.id}>
            {track.label}
          </option>
        ))}
      </select>
    </div>
  )
}

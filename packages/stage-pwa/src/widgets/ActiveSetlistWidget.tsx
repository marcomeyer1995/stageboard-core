import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
import { useQueue } from '../lib/queue'

/** A glanceable "which setlist is live right now" readout, for a dashboard that doesn't
 * already show it via Live-Queue/Next-Song - the same question Marco wanted answered in
 * the Bibliothek (LibraryView.tsx/SetlistDetail.tsx's "● Aktiv" badges) and the main menu
 * (MasterControl.tsx). */
export function ActiveSetlistWidget() {
  const { activeSetlist } = useQueue()
  // Chosen over cq units/discrete tiers after Marco compared all three live (2026-09-14,
  // see the widget-font-autofit memory).
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 12, max: 64 },
    [activeSetlist?.id],
  )

  return (
    <div className="flex h-full flex-col items-center gap-1 text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
        Aktive Setlist
      </span>
      <div ref={containerRef} className="flex w-full flex-1 items-center justify-center overflow-hidden">
        <span
          ref={textRef}
          style={{ fontSize }}
          className={`whitespace-nowrap font-semibold ${activeSetlist ? 'text-ink' : 'text-ink-faint'}`}
        >
          {activeSetlist ? activeSetlist.name : 'Keine'}
        </span>
      </div>
      {activeSetlist && <span className="text-sm text-ink-muted">{activeSetlist.entries.length} Songs</span>}
    </div>
  )
}

import { useQueue } from '../lib/queue'

/** A glanceable "which setlist is live right now" readout, for a dashboard that doesn't
 * already show it via Live-Queue/Next-Song - the same question Marco wanted answered in
 * the Bibliothek (LibraryView.tsx/SetlistDetail.tsx's "● Aktiv" badges) and the main menu
 * (MasterControl.tsx). */
export function ActiveSetlistWidget() {
  const { activeSetlist } = useQueue()

  if (!activeSetlist) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
          Aktive Setlist
        </span>
        <span className="text-ink-faint">Keine</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
        Aktive Setlist
      </span>
      <span className="text-lg font-semibold text-ink">{activeSetlist.name}</span>
      <span className="text-sm text-ink-muted">{activeSetlist.entries.length} Songs</span>
    </div>
  )
}

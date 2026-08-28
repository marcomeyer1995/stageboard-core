import { useQueue } from '../lib/queue'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * The Master-Token claim, previously reachable only from inside NextSongWidget/
 * LiveQueueWidget - a band running a dashboard without either widget had no way to claim
 * control at all. Lives in the main menu instead so it's always reachable regardless of
 * which widgets happen to be on the active dashboard. Also surfaces the active setlist here
 * - the same "which setlist is live right now" question Marco wanted visible in the
 * Bibliothek too (LibraryView.tsx/SetlistDetail.tsx's "● Aktiv" badges).
 */
export function MasterControl() {
  const { isMaster, activeSetlist } = useQueue()
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  return (
    <div className="flex flex-col gap-2">
      {isMaster ? (
        <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
          Master-Kontrolle
          <span className="text-sm text-accent">Dieses Gerät</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={claimMaster}
          title="Dieses Gerät hat aktuell keine Kontrolle über die Queue"
          className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
        >
          Master-Kontrolle
          <span className="font-medium text-accent">Übernehmen</span>
        </button>
      )}
      <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
        Aktive Setlist
        {activeSetlist ? (
          <span className="font-medium text-accent">{activeSetlist.name}</span>
        ) : (
          <span className="text-sm text-ink-faint">Keine</span>
        )}
      </div>
    </div>
  )
}

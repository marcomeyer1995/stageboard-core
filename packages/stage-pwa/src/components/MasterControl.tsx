import { useQueue } from '../lib/queue'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * The Master-Token claim, previously reachable only from inside NextSongWidget/
 * LiveQueueWidget - a band running a dashboard without either widget had no way to claim
 * control at all. Lives in the main menu instead so it's always reachable regardless of
 * which widgets happen to be on the active dashboard.
 */
export function MasterControl() {
  const { isMaster } = useQueue()
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  if (isMaster) {
    return (
      <div className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft">
        Master-Kontrolle
        <span className="text-sm text-accent">Diese Ansicht</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={claimMaster}
      title="Diese Ansicht hat aktuell keine Kontrolle über die Queue"
      className="flex h-12 items-center justify-between rounded-sb bg-control px-4 text-base text-ink-soft hover:bg-control-hover"
    >
      Master-Kontrolle
      <span className="font-medium text-accent">Übernehmen</span>
    </button>
  )
}

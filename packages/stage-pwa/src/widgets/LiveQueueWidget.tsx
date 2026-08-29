import { reorderToPlayNext } from '../lib/computeQueue'
import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'

/** docs/07 section 3: "die nächsten 5-10 Songs". */
const WINDOW_SIZE = 8

/**
 * The sidebar view of the upcoming setlist (docs/07 section 3). Reordering ("Als nächstes
 * spielen") is a tap on a per-row button rather than the doc's swipe-gesture/context-menu
 * language - no gesture or drag library exists in this codebase yet, and a tap is far
 * less risky to get right without real device testing (see docs/03's Live-Tablet-Debugging
 * section for why that matters here).
 */
export function LiveQueueWidget() {
  const { activeSetlist, orderedItems, currentSong, isMaster } = useQueue()
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const claimMaster = useShowStateStore((state) => state.claimMaster)

  const currentIndex = currentSong
    ? orderedItems.findIndex((item) => item.song.id === currentSong.id)
    : -1
  const upcoming = orderedItems.slice(currentIndex + 1, currentIndex + 1 + WINDOW_SIZE)

  function playNext(entryId: string) {
    if (!activeSetlist) return
    const currentEntryId = currentIndex >= 0 ? (orderedItems[currentIndex]?.entry.id ?? null) : null
    void saveSetlist({
      ...activeSetlist,
      entries: reorderToPlayNext(activeSetlist.entries, entryId, currentEntryId),
    })
  }

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto text-sm text-ink-soft">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Queue</p>
        {!isMaster && (
          <button
            type="button"
            onClick={claimMaster}
            title="Dieses Gerät hat aktuell keine Kontrolle über die Queue"
            className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs font-medium text-accent hover:bg-control-strong-hover"
          >
            Master übernehmen
          </button>
        )}
      </div>

      {upcoming.length === 0 && (
        <p className="text-ink-faint">
          {activeSetlist ? 'Keine weiteren Songs in der Setlist.' : 'Keine Setlist aktiv.'}
        </p>
      )}

      {upcoming.map((item, i) => (
        <div
          key={item.entry.id}
          className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-2 py-1"
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="mr-2 text-ink-faint">{i + 1}.</span>
            {item.song.title}
            {item.variant && !item.variant.isDefault && (
              <span className="ml-2 text-xs text-accent">({item.variant.label})</span>
            )}
          </span>
          {isMaster && activeSetlist && i > 0 && (
            <button
              type="button"
              onClick={() => playNext(item.entry.id)}
              title="Als nächstes spielen"
              className="flex-shrink-0 rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs text-ink hover:bg-control-strong-hover"
            >
              Als nächstes
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { OverflowMenu } from '../components/OverflowMenu'
import { reorderToPlayNext } from '../lib/computeQueue'
import type { QueueItem } from '../lib/computeQueue'
import { useQueue } from '../lib/queue'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import type { ContentFontSizeConfig } from './contentFontSizeConfig'

/** docs/07 section 3: "die nächsten 5-10 Songs". */
const WINDOW_SIZE = 8

interface QueueRowProps {
  item: QueueItem
  index: number
  canManage: boolean
  /** Omitted for the row already up next - "Als nächstes spielen" on it would be a no-op. */
  onPlayNext: ((entryId: string) => void) | null
  onRemove: (entryId: string) => void
}

/** Same grip-handle-carries-the-drag shape as SetlistDetail.tsx's own EntryRow (#18 follow-up
 * to that pattern) - the handle owns `touchAction: none` so it can grab the gesture outright,
 * while the rest of the row keeps the widget's own `overflow-y-auto` scroll working untouched.
 * Row actions live behind the same "⋯" `OverflowMenu` LibraryView/SetlistDetail already use
 * instead of a long-press context menu, so this doesn't compete with the drag gesture above,
 * and instead of the old always-visible "Als nächstes" button, which ate too much row width. */
function QueueRow({ item, index, canManage, onPlayNext, onRemove }: QueueRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.entry.id,
    disabled: !canManage,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 rounded-sb-sm bg-control px-2 py-1 ${isDragging ? 'opacity-50' : ''}`}
    >
      {canManage && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          style={{ touchAction: 'none' }}
          className="flex h-8 w-6 flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
          aria-label="Ziehen zum Sortieren"
        >
          ⠿
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="mr-2 text-ink-faint">{index + 1}.</span>
        {item.song.title}
        {item.variant && !item.variant.isDefault && (
          <span className="ml-2 text-xs text-accent">({item.variant.label})</span>
        )}
      </span>
      {canManage && (
        <OverflowMenu
          title={item.song.title}
          variant="flat"
          actions={[
            ...(onPlayNext
              ? [{ label: 'Als nächstes spielen', onClick: () => onPlayNext(item.entry.id) }]
              : []),
            { label: 'Aus Queue entfernen', danger: true, onClick: () => onRemove(item.entry.id) },
          ]}
        />
      )}
    </div>
  )
}

/**
 * The sidebar view of the upcoming setlist (docs/07 section 3). Reordering (drag, via a grip
 * handle) and per-row actions ("Als nächstes spielen" / "Aus Queue entfernen", via the "⋯" menu)
 * follow the same patterns SetlistDetail.tsx and LibraryView.tsx already use - not the doc's
 * original swipe/long-press-context-menu language, which would compete with the drag gesture
 * above on the same touch input (Marco, explicit call after weighing it against #18's own draft).
 */
export function LiveQueueWidget({ config }: { config: ContentFontSizeConfig }) {
  const { activeSetlist, orderedItems, currentSong, isMaster } = useQueue()
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const fontSize = useContentFontSize(config)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const currentIndex = currentSong
    ? orderedItems.findIndex((item) => item.song.id === currentSong.id)
    : -1
  const upcoming = orderedItems.slice(currentIndex + 1, currentIndex + 1 + WINDOW_SIZE)
  const canManage = isMaster && !!activeSetlist

  function playNext(entryId: string) {
    if (!activeSetlist) return
    const currentEntryId = currentIndex >= 0 ? (orderedItems[currentIndex]?.entry.id ?? null) : null
    void saveSetlist({
      ...activeSetlist,
      entries: reorderToPlayNext(activeSetlist.entries, entryId, currentEntryId),
    })
  }

  function removeFromQueue(entryId: string) {
    if (!activeSetlist) return
    void saveSetlist({
      ...activeSetlist,
      entries: activeSetlist.entries.filter((entry) => entry.id !== entryId),
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!activeSetlist || !event.over || event.active.id === event.over.id) return
    const from = activeSetlist.entries.findIndex((entry) => entry.id === event.active.id)
    const to = activeSetlist.entries.findIndex((entry) => entry.id === event.over?.id)
    if (from === -1 || to === -1) return
    void saveSetlist({ ...activeSetlist, entries: arrayMove(activeSetlist.entries, from, to) })
  }

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto text-ink-soft" style={{ fontSize }}>
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

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={upcoming.map((item) => item.entry.id)} strategy={verticalListSortingStrategy}>
          {upcoming.map((item, i) => (
            <QueueRow
              key={item.entry.id}
              item={item}
              index={i}
              canManage={canManage}
              onPlayNext={i > 0 ? playNext : null}
              onRemove={removeFromQueue}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}

const PREVIEW_SONGS = ['Highway to Hell', 'Wie ein schützender Engel', 'Sweet Home Alabama']

/**
 * Static stand-in for the Widget Gallery (#22) - the real component reads the active
 * setlist's queue (`useQueue()`), which is empty during ordinary Edit-Mode browsing (no
 * show running) and would otherwise render nothing but "Keine Setlist aktiv.", telling a
 * musician nothing about what this widget actually looks like mid-gig. Mirrors the real
 * row markup with a few representative song titles instead.
 */
export function LiveQueueWidgetPreview() {
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto text-sm text-ink-soft">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Queue</p>
      {PREVIEW_SONGS.map((title, i) => (
        <div key={title} className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-2 py-1">
          <span className="min-w-0 flex-1 truncate">
            <span className="mr-2 text-ink-faint">{i + 1}.</span>
            {title}
          </span>
        </div>
      ))}
    </div>
  )
}

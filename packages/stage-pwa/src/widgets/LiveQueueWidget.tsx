import { useEffect, useRef } from 'react'
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

type RowStatus = 'past' | 'current' | 'upcoming'

interface QueueRowProps {
  item: QueueItem
  index: number
  status: RowStatus
  canManage: boolean
  /** Omitted for the row already up next - "Als nächstes spielen" on it would be a no-op. */
  onPlayNext: ((entryId: string) => void) | null
  onRemove: (entryId: string) => void
  /** Only invoked by the 'current' row - lets the widget scroll it into view (Marco, explicit
   * request: the whole setlist is visible now, so the currently playing song needs its own
   * way to stay findable instead of relying on it always being the first row). */
  currentRowRef?: (el: HTMLDivElement | null) => void
}

/** Same grip-handle-carries-the-drag shape as SetlistDetail.tsx's own EntryRow (#18 follow-up
 * to that pattern) - the handle owns `touchAction: none` so it can grab the gesture outright,
 * while the rest of the row keeps the widget's own `overflow-y-auto` scroll working untouched.
 * Row actions live behind the same "⋯" `OverflowMenu` LibraryView/SetlistDetail already use
 * instead of a long-press context menu, so this doesn't compete with the drag gesture above,
 * and instead of the old always-visible "Als nächstes" button, which ate too much row width. */
function QueueRow({ item, index, status, canManage, onPlayNext, onRemove, currentRowRef }: QueueRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.entry.id,
    disabled: !canManage,
  })

  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        if (status === 'current') currentRowRef?.(el)
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 rounded-sb-sm px-2 py-1 ${isDragging ? 'opacity-50' : ''} ${
        status === 'current'
          ? 'bg-accent text-accent-ink font-semibold'
          : status === 'past'
            ? 'bg-control text-ink-faint opacity-60'
            : 'bg-control'
      }`}
    >
      {canManage && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          style={{ touchAction: 'none' }}
          className={`flex h-8 w-6 flex-shrink-0 cursor-grab items-center justify-center active:cursor-grabbing ${
            status === 'current' ? 'text-accent-ink' : 'text-ink-faint'
          }`}
          aria-label="Ziehen zum Sortieren"
        >
          ⠿
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className={`mr-2 ${status === 'current' ? '' : 'text-ink-faint'}`}>{index + 1}.</span>
        {item.song.title}
        {item.variant && !item.variant.isDefault && (
          <span className={`ml-2 text-xs ${status === 'current' ? '' : 'text-accent'}`}>
            ({item.variant.label})
          </span>
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
 * The sidebar view of the full setlist (docs/07 section 3) - every entry, not just a window of
 * upcoming ones: already-played songs stay visible (grayed out) by scrolling up, the current
 * song is highlighted, and the rest of the setlist is reachable by scrolling down. Reordering
 * (drag, via a grip handle) and per-row actions ("Als nächstes spielen" / "Aus Queue entfernen",
 * via the "⋯" menu) follow the same patterns SetlistDetail.tsx and LibraryView.tsx already use -
 * not the doc's original swipe/long-press-context-menu language, which would compete with the
 * drag gesture above on the same touch input (Marco, explicit call after weighing it against
 * #18's own draft).
 */
export function LiveQueueWidget({ config }: { config: ContentFontSizeConfig }) {
  const { activeSetlist, orderedItems, currentEntry, isMaster } = useQueue()
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const fontSize = useContentFontSize(config)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const currentRowEl = useRef<HTMLDivElement | null>(null)

  // By entry id, not songId (`currentEntry` already resolves this correctly, see computeQueue.ts)
  // - the same song can appear twice in a setlist with two different variants, and matching by
  // songId alone would always resolve to whichever occurrence comes first, misplacing "current"
  // and every past/upcoming split derived from it whenever that happened (Marco, reported live).
  const currentIndex = currentEntry
    ? orderedItems.findIndex((item) => item.entry.id === currentEntry.id)
    : -1
  const canManage = isMaster && !!activeSetlist

  useEffect(() => {
    currentRowEl.current?.scrollIntoView({ block: 'center' })
  }, [currentEntry?.id])

  function playNext(entryId: string) {
    if (!activeSetlist) return
    void saveSetlist({
      ...activeSetlist,
      entries: reorderToPlayNext(activeSetlist.entries, entryId, currentEntry?.id ?? null),
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

      {orderedItems.length === 0 && (
        <p className="text-ink-faint">{activeSetlist ? 'Keine Songs in der Setlist.' : 'Keine Setlist aktiv.'}</p>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedItems.map((item) => item.entry.id)} strategy={verticalListSortingStrategy}>
          {orderedItems.map((item, i) => {
            const status: RowStatus = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'upcoming'
            const isImmediateNext = i === currentIndex + 1
            return (
              <QueueRow
                key={item.entry.id}
                item={item}
                index={i}
                status={status}
                canManage={canManage && status === 'upcoming'}
                onPlayNext={status === 'upcoming' && !isImmediateNext ? playNext : null}
                onRemove={removeFromQueue}
                currentRowRef={(el) => {
                  currentRowEl.current = el
                }}
              />
            )
          })}
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
        <div
          key={title}
          className={`flex items-center justify-between gap-2 rounded-sb-sm px-2 py-1 ${
            i === 0 ? 'bg-accent text-accent-ink font-semibold' : 'bg-control'
          }`}
        >
          <span className="min-w-0 flex-1 truncate">
            <span className={`mr-2 ${i === 0 ? '' : 'text-ink-faint'}`}>{i + 1}.</span>
            {title}
          </span>
        </div>
      ))}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { OverflowMenu } from '../components/OverflowMenu'
import { isHeadingEntry, isTransitionEntry } from 'shared-types'
import { formatItemSeconds } from '../lib/formatItemDuration'
import { queueItemTitle, reorderToPlayNext } from '../lib/computeQueue'
import type { QueueItem } from '../lib/computeQueue'
import { useShowMode } from '../lib/showMode'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useLongPress } from '../lib/useLongPress'
import { useSetlistsStore } from '../store/useSetlistsStore'
import type { ContentFontSizeConfig } from './contentFontSizeConfig'
import { MasterTakeoverButton } from '../components/MasterTakeoverButton'
import { Icon } from '../components/Icon'
import { stageVariantLabel } from '../lib/variantLabel'

type RowStatus = 'past' | 'current' | 'upcoming'

interface QueueRowProps {
  item: QueueItem
  /** The song's position among the songs only - null for transition items and section headings,
   * which aren't numbered. */
  number: number | null
  status: RowStatus
  /** Master with an active setlist, on an upcoming row: the row has actions. */
  canManage: boolean
  /** Sort mode: drag handle and a visible "⋮" trigger. Outside it the row is title only and its
   * actions open on a long press. */
  sorting: boolean
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
 *
 * Handle and menu trigger only show in sort mode (GUI audit 2026-09-26: always visible, they
 * took a third of a 256px widget's width and cut titles after ~9 characters). Outside it a row
 * is title only, up to two lines, and a long press opens its actions ("Als nächstes spielen" /
 * "Aus Queue entfernen") - the long press no longer competes with dragging, which is why the
 * menu was a "⋯" button before (Marco, 2026-09-27). The trigger is "⋮", unlike the widget's own
 * "⋯" menu beside it in edit mode.
 */
function QueueRow({ item, number, status, canManage, sorting, onPlayNext, onRemove, currentRowRef }: QueueRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.entry.id,
    disabled: !canManage || !sorting,
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [longPress, pressing] = useLongPress(() => setMenuOpen(true), canManage && !sorting)
  const isSection = isHeadingEntry(item.entry)
  const isTransition = isTransitionEntry(item.entry) && !isSection

  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        if (status === 'current') currentRowRef?.(el)
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...longPress}
      className={`flex select-none items-center gap-1 px-2 py-1 ${isDragging ? 'opacity-50' : ''} ${pressing ? 'brightness-125' : ''} ${
        isSection
          ? `mt-2 rounded-control border-b-2 ${
              status === 'current' ? 'border-accent-ink bg-accent text-accent-ink' : 'border-accent bg-transparent'
            } ${status === 'past' ? 'opacity-50' : ''}`
          : `rounded-control ${isTransition ? 'border border-dashed border-accent' : ''} ${
              status === 'current'
                ? 'bg-accent text-accent-ink font-semibold'
                : status === 'past'
                  ? 'bg-control text-ink-faint opacity-60'
                  : 'bg-control'
            }`
      }`}
    >
      {canManage && sorting && (
        <button
          type="button"
          {...listeners}
          {...attributes}
          style={{ touchAction: 'none' }}
          className={`flex h-form w-10 flex-shrink-0 cursor-grab items-center justify-center active:cursor-grabbing ${
            status === 'current' ? 'text-accent-ink' : 'text-ink-faint'
          }`}
          aria-label="Ziehen zum Sortieren"
        >
          ⠿
        </button>
      )}
      {isSection ? (
        <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-widest">
          {queueItemTitle(item)}
          {isTransitionEntry(item.entry) && item.entry.estimatedDurationMs ? (
            <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
              {formatItemSeconds(item.entry.estimatedDurationMs)}
            </span>
          ) : null}
        </span>
      ) : isTransition ? (
        <span className="line-clamp-2 min-w-0 flex-1 break-words italic">
          <span className={`mr-2 text-xs font-bold not-italic uppercase tracking-wider ${status === 'current' ? '' : 'text-accent'}`}>
            Ansage
          </span>
          {queueItemTitle(item)}
          {isTransitionEntry(item.entry) && item.entry.estimatedDurationMs ? (
            <span className={`ml-2 text-xs ${status === 'current' ? '' : 'text-ink-faint'}`}>
              {formatItemSeconds(item.entry.estimatedDurationMs)}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="line-clamp-2 min-w-0 flex-1 break-words">
          <span className={`mr-2 ${status === 'current' ? '' : 'text-ink-faint'}`}>{number}.</span>
          {queueItemTitle(item)}
          {item.variant && !item.variant.isDefault && (
            <span className={`ml-2 text-xs ${status === 'current' ? '' : 'text-accent'}`}>
              ({stageVariantLabel(item.variant.label)})
            </span>
          )}
        </span>
      )}
      {canManage && (
        <OverflowMenu
          title={queueItemTitle(item)}
          variant="flat"
          glyph="moreVertical"
          triggerSize="touch"
          hideTrigger={!sorting}
          open={menuOpen}
          onOpenChange={setMenuOpen}
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
 * (drag, via a grip handle) happens in a sort mode the Master opens with "⇅ Sortieren" and
 * closes with "Fertig" - or by pressing Play, so forgotten handles never stay up on stage (Marco,
 * 2026-09-27). Per-row actions open on a long press, in sort mode also from the row's "⋮".
 */
export function LiveQueueWidget({ config }: { config: ContentFontSizeConfig }) {
  const {
    mode,
    canControl,
    playbackStatus,
    queue: { activeSetlist, orderedItems, currentEntry },
  } = useShowMode()
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
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
  const canManage = canControl && !!activeSetlist
  const [sortingOpen, setSorting] = useState(false)
  const sorting = sortingOpen && canManage

  // Play closes sort mode.
  useEffect(() => {
    if (playbackStatus === 'playing') setSorting(false)
  }, [playbackStatus])

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
        {canManage && (
          <button
            type="button"
            aria-pressed={sorting}
            onClick={() => setSorting(!sorting)}
            className={`h-touch flex-shrink-0 rounded-control px-3 text-base font-semibold ${
              sorting ? 'bg-accent text-accent-ink' : 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'
            }`}
          >
            {sorting ? (
              'Fertig'
            ) : (
              <span className="flex items-center gap-1">
                <Icon name="sort" /> Sortieren
              </span>
            )}
          </button>
        )}
        {mode === 'gig' && !canControl && (
          <MasterTakeoverButton
            className="h-touch flex-shrink-0 rounded-control bg-control-strong px-3 text-base font-semibold text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
          />
        )}
      </div>

      {orderedItems.length === 0 && (
        <p className="text-ink-faint">{activeSetlist ? 'Keine Songs in der Setlist.' : 'Keine Setlist aktiv.'}</p>
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedItems.map((item) => item.entry.id)} strategy={verticalListSortingStrategy}>
          {orderedItems.map((item, i) => {
            const songNumber = item.song ? orderedItems.slice(0, i + 1).filter((it) => it.song).length : null
            const status: RowStatus = i < currentIndex ? 'past' : i === currentIndex ? 'current' : 'upcoming'
            const isImmediateNext = i === currentIndex + 1
            return (
              <QueueRow
                key={item.entry.id}
                item={item}
                number={songNumber}
                status={status}
                canManage={canManage && status === 'upcoming'}
                sorting={sorting}
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

const PREVIEW_ROWS: { kind: 'section' | 'song' | 'announcement'; title: string }[] = [
  { kind: 'section', title: 'Set 1' },
  { kind: 'song', title: 'Highway to Hell' },
  { kind: 'announcement', title: 'Ansage Merch-Stand' },
  { kind: 'song', title: 'Wie ein schützender Engel' },
  { kind: 'song', title: 'Sweet Home Alabama' },
]

/**
 * Static stand-in for the Widget Gallery (#22) - the real component reads the active
 * setlist's queue (`useQueue()`), which is empty during ordinary Edit-Mode browsing (no
 * show running) and would otherwise render nothing but "Keine Setlist aktiv.", telling a
 * musician nothing about what this widget actually looks like mid-gig. Mirrors the real
 * row markup with a few representative rows instead, including a section heading and an
 * announcement so the special items are recognisable.
 */
export function LiveQueueWidgetPreview() {
  let songNumber = 0
  let currentShown = false
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto text-sm text-ink-soft">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">Queue</p>
      {PREVIEW_ROWS.map((row) => {
        if (row.kind === 'section') {
          return (
            <div key={row.title} className="mt-1 border-b-2 border-accent px-2 py-1 text-xs font-bold uppercase tracking-widest">
              {row.title}
            </div>
          )
        }
        const current = row.kind === 'song' && !currentShown
        if (current) currentShown = true
        if (row.kind === 'song') songNumber += 1
        return (
          <div
            key={row.title}
            className={`flex items-center gap-2 rounded-control px-2 py-1 ${
              row.kind === 'announcement' ? 'border border-dashed border-accent bg-control italic' : current ? 'bg-accent text-accent-ink font-semibold' : 'bg-control'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">
              {row.kind === 'announcement' ? (
                <span className="mr-2 text-xs font-bold not-italic uppercase tracking-wider text-accent">Ansage</span>
              ) : (
                <span className={`mr-2 ${current ? '' : 'text-ink-faint'}`}>{songNumber}.</span>
              )}
              {row.title}
            </span>
          </div>
        )
      })}
    </div>
  )
}

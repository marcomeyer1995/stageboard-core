import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Setlist, Song } from 'shared-types'
import { clampSwipe } from '../lib/clampSwipe'
import { randomId } from '../lib/id'
import { useQueue } from '../lib/queue'
import { useInputCapability } from '../lib/useInputCapability'
import { useIsPanelLayout } from '../lib/useIsPanelLayout'
import { useAudioPinsStore } from '../store/useAudioPinsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { OverflowMenu } from './OverflowMenu'
import { SetlistDetail } from './SetlistDetail'
import { SheetEditor } from './SheetEditor'
import { SongPreview } from './SongPreview'

type Selection =
  | { type: 'setlist'; id: string }
  | { type: 'song'; songId: string; variantId: string | null }
  | null

type FilterMode = 'all' | 'setlists' | 'songs'

const FILTER_LABEL: Record<FilterMode, string> = {
  all: 'Alle',
  setlists: 'Setlists',
  songs: 'Songs',
}

/** How far right a song has to travel, with nowhere to drop, before it counts as a swipe
 * rather than an aborted drag - well past the sensor's own activation distance, and
 * comfortably under `clampSwipe`'s own ceiling (half a row's width, always far more than
 * 90px on any real row) since `event.delta` in onDragEnd is itself post-modifier. */
const SWIPE_THRESHOLD_PX = 90
const SETLIST_DROPZONE_ID = 'library-setlist-dropzone'

function songEntry(songId: string) {
  return { id: randomId(), songId, variantId: null as string | null, trackId: null as string | null }
}

interface DraggableSongRowProps {
  song: Song
  onClick: () => void
  /** Same selected-state treatment the Setlists list already has (Marco: "why is the setlist
   * highlighted after clicking, but the song not?" - it simply never got one). */
  selected: boolean
  /** True only in the pointer/mouse lane (Marco, explicit request) - the "+" button and the
   * swipe gesture below are two ways to do the same thing, and each only makes sense for one
   * input type: dragging/swiping is natural on touch but awkward with a mouse, while a mouse
   * user has no reason to reach for an ambiguous drag gesture when a precise click is right
   * there. `null` (not `showAddButton=false` with a disabled button) means no setlist is
   * active right now - disables the button instead of hiding it (same "tell the user why,
   * don't just make it disappear" instinct the swipe's own message already has). */
  onAddToActiveSetlist: (() => void) | null
  showAddButton: boolean
  /** True only in the touch lane - the reveal-on-drag "+ Zur aktiven Setlist" background and
   * the swipe-to-add fallback in LibraryView's handleDragEnd. */
  showSwipeReveal: boolean
  /** Pinned = always kept cached offline in "Selective" audio-sync mode (#49), independent
   * of whether the song is in the active setlist - toggled from the ⋯ menu (Marco, explicit
   * request to declutter the row), which trades away the previous always-visible pinned
   * indicator for a shorter row; the menu label itself still reflects current state
   * ("Offline anheften" vs. "Offline-Pin entfernen"). */
  pinned: boolean
  onTogglePin: () => void
  /** Prompts for a new title itself - same shape as SetlistDetail's own handleDuplicate. Only
   * reachable from the pointer-lane row menu (#178); touch's own ⋯ menu stays as it was. */
  onDuplicate: () => void
  /** Confirmation lives in the caller (matches every other delete flow in the app) - this is
   * called only once the user has already said yes. */
  onDelete: () => void
  /** Ring outline from LibraryView's own arrow-key list navigation (#178, pointer lane) -
   * separate from `selected` (bg-accent, "this is open in the right pane right now"), since
   * the keyboard-focused row and the currently-open one aren't always the same row. */
  keyboardFocused: boolean
}

function DraggableSongRow({
  song,
  onClick,
  selected,
  onAddToActiveSetlist,
  showAddButton,
  showSwipeReveal,
  pinned,
  onTogglePin,
  onDuplicate,
  onDelete,
  keyboardFocused,
}: DraggableSongRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `song:${song.id}`,
    // Drag/swipe is a touch-only gesture now (Marco, explicit request) - the pointer/mouse
    // lane has the "+" button instead, so there's no drag left to disambiguate there at all,
    // not even the "drop directly onto an open setlist pane" case #191 still allowed.
    disabled: !showSwipeReveal,
  })
  // Right-click as an alternative to the "+" button/swipe gesture (#178, pointer lane only -
  // "not a replacement, both keep working") - controlled so the row itself can open it, not
  // just its own "⋯" trigger. showAddButton is exactly the pointer-lane signal already, no
  // need for a second prop that could drift out of sync with it.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuActions = showAddButton
    ? [
        {
          label: 'Zur aktiven Setlist hinzufügen',
          onClick: () => onAddToActiveSetlist?.(),
          disabled: !onAddToActiveSetlist,
        },
        { label: 'Duplizieren', onClick: onDuplicate },
        { label: pinned ? 'Offline-Pin entfernen' : 'Offline anheften', onClick: onTogglePin },
        { label: 'Löschen', danger: true, onClick: onDelete },
      ]
    : [
        { label: pinned ? 'Offline-Pin entfernen' : 'Offline anheften', onClick: onTogglePin },
        { label: 'Löschen', danger: true, onClick: onDelete },
      ]

  return (
    <li className="relative overflow-hidden rounded-sb-sm">
      {/* Revealed by the row above sliding right - a solid row background at rest fully
          covers this, so no opacity/width math is needed to fake the Spotify swipe-reveal.
          Touch lane only - a mouse user dragging onto an open setlist pane isn't "swiping to
          the active setlist" at all, so this message would just be wrong for them.
          bg-control-strong, not bg-accent-2 (Marco: swiping a *selected* row was invisible -
          every theme's accent-2 is literally the same color as accent, so the row sliding away
          and the reveal underneath it were indistinguishable). control-strong is a neutral
          shade distinct from both bg-control (an unselected row) and bg-accent (a selected
          one), so the reveal stays visible either way. */}
      {showSwipeReveal && (
        <div className="absolute inset-0 flex items-center bg-control-strong px-4 text-sm font-medium text-ink">
          + Zur aktiven Setlist
        </div>
      )}
      {/* The listeners/ref live on this row surface itself, not just the title button inside it
          (Marco: after the first pass only the text was swipeable, not "the box" the way it used
          to be - here the whole visible row is the drag/swipe target, Spotify-style, same as
          before the "+"/⋯ split existed). A plain tap on the title, "+", or ⋯ still resolves as
          a click rather than a drag: the sensor's own 8px activationConstraint (see `sensors`
          below) only starts a drag once the pointer has actually moved, so it never swallows a
          same-spot tap on a nested button. "+"/⋯ read as unboxed accents within this row rather
          than boxes of their own (Marco, explicit request), the same way the ⠿ grip handle sits
          unboxed on SetlistDetail's own row. */}
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onContextMenu={(e) => {
          // Touch lane: leave the native long-press context menu alone entirely - this row
          // has no context menu to offer there, same actions already reachable via ⋯.
          if (!showAddButton) return
          e.preventDefault()
          setMenuOpen(true)
        }}
        style={{
          transform: CSS.Translate.toString(transform),
          transition: isDragging ? undefined : 'transform 200ms ease',
          // Without this, a touch device's browser claims the gesture as a native scroll
          // before dnd-kit's PointerSensor ever sees it - drags never start at all on a
          // real tablet/phone (confirmed live). pan-y (not none) keeps vertical list
          // scrolling working natively; only the horizontal swipe/drag is JS-driven.
          touchAction: 'pan-y',
        }}
        className={`relative z-10 flex items-center gap-1 rounded-sb-sm py-1 pl-2 pr-1 ${
          selected ? 'bg-accent text-accent-ink' : 'bg-control hover:bg-control-hover'
        } ${keyboardFocused ? 'ring-2 ring-inset ring-accent' : ''}`}
      >
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 truncate px-2 py-2 text-left text-base"
        >
          {song.title || '(ohne Titel)'}
          {song.artist && <span className={selected ? '' : 'text-ink-faint'}> — {song.artist}</span>}
        </button>
        {showAddButton && (
          <button
            type="button"
            onClick={() => onAddToActiveSetlist?.()}
            disabled={!onAddToActiveSetlist}
            title={onAddToActiveSetlist ? 'Zur aktiven Setlist hinzufügen' : 'Keine aktive Setlist'}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sb-sm text-xl text-ink-faint hover:bg-control-hover hover:text-ink disabled:opacity-40"
          >
            +
          </button>
        )}
        <OverflowMenu
          title={song.title || '(ohne Titel)'}
          variant="flat"
          actions={menuActions}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      </div>
    </li>
  )
}

/**
 * The "Bibliothek" (#20, refined for a Spotify-style mobile experience): search + a
 * horizontal Alle/Setlists/Songs filter, setlists newest-first then songs alphabetically,
 * and one drag gesture on every song row that lands differently depending on where it goes -
 * dropped onto an open setlist (desktop, both panes visible) adds it there; swiped right with
 * nowhere to drop (works on any screen size, including mobile) adds it to the *active*
 * setlist instead. Clicking a setlist shows its songs (via SetlistDetail, which still owns
 * all the actual setlist-management logic - reorder, variant pick, add/remove, duplicate,
 * activate); clicking any song shows a read-only SongPreview in the right pane first, same as
 * a setlist - a dedicated "Bearbeiten" button there is what actually opens SheetEditor
 * (Marco, explicit request: "as it is for the Setlists").
 */
export function LibraryView() {
  const songs = useSongsStore((state) => state.songs)
  const saveSong = useSongsStore((state) => state.saveSong)
  const duplicateSong = useSongsStore((state) => state.duplicateSong)
  const removeSong = useSongsStore((state) => state.remove)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const { activeSetlist } = useQueue()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const pinnedSongIds = useAudioPinsStore((state) => state.pinsFor(workspaceId))
  const togglePin = useAudioPinsStore((state) => state.togglePin)
  const promptText = useDialogStore((state) => state.promptText)
  const confirm = useDialogStore((state) => state.confirm)
  // Gates the arrow-key list navigation below - Enter shouldn't also act on a focused list row
  // while e.g. a delete confirmation is open on top of it.
  const dialogOpen = useDialogStore((state) => state.request !== null)
  const inputCapability = useInputCapability()
  // Two-pane breakpoint (#178): moved down from a flat lg (1024px) to "desktop-wide, or
  // landscape at tablet width already" - a landscape tablet has the room for two panes well
  // below 1024px, same threshold SheetEditor.tsx's own 'panel' tier already uses.
  const isPanel = useIsPanelLayout()
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [selection, setSelection] = useState<Selection>(null)
  // A song selection always starts in 'preview' (SongPreview, in the right pane) - 'edit' only
  // once its "Bearbeiten" button is clicked, which is what actually opens the full-page
  // SheetEditor. Irrelevant while selection isn't a song.
  const [songMode, setSongMode] = useState<'preview' | 'edit'>('preview')
  const [swipeMessage, setSwipeMessage] = useState<string | null>(null)
  // Keyboard row navigation (#178, pointer lane only) - a separate "which row is arrow-keyed"
  // cursor from `selection` itself (see keyboardFocused's own doc comment on DraggableSongRow).
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const { setNodeRef: setDropzoneRef, isOver } = useDroppable({
    id: SETLIST_DROPZONE_ID,
    disabled: selection?.type !== 'setlist',
  })

  const term = search.trim().toLowerCase()
  const filteredSetlists = useMemo(() => {
    const matches = term ? setlists.filter((s) => s.name.toLowerCase().includes(term)) : setlists
    return [...matches].sort((a, b) => b.createdAt - a.createdAt)
  }, [setlists, term])
  const filteredSongs = useMemo(() => {
    const matches = term
      ? songs.filter(
          (s) => s.title.toLowerCase().includes(term) || s.artist?.toLowerCase().includes(term),
        )
      : songs
    return [...matches].sort((a, b) => a.title.localeCompare(b.title))
  }, [songs, term])

  // Flat, on-screen-order list of what ↑/↓ actually moves through - setlists (if the current
  // filter shows them) then songs (if it shows those), matching the two <ul>s below exactly.
  const focusableItems = useMemo(() => {
    const items: Array<{ type: 'setlist' | 'song'; id: string }> = []
    if (filterMode !== 'songs') for (const s of filteredSetlists) items.push({ type: 'setlist', id: s.id })
    if (filterMode !== 'setlists') for (const s of filteredSongs) items.push({ type: 'song', id: s.id })
    return items
  }, [filterMode, filteredSetlists, filteredSongs])

  /** Shared by the song row's own click and SetlistDetail's onSelectSong - both land on the
   * preview, never straight on the editor. Clicking the already-selected song again closes
   * the preview instead of re-opening it (Marco, explicit request, same toggle as a setlist
   * below) - only reachable from the Bibliothek's own row today, since selecting a song from
   * inside a setlist replaces that setlist's own view entirely, so there's no "already
   * selected" row left showing to re-click there. useCallback (not a plain function
   * declaration, like every other handler here) so the keyboard-nav effect below can list it as
   * a real dependency without tearing its listener down on every render - just on the ones
   * where `selection` itself actually changes. */
  const selectSong = useCallback(
    (songId: string, variantId: string | null) => {
      if (selection?.type === 'song' && selection.songId === songId && selection.variantId === variantId) {
        setSelection(null)
        return
      }
      setSelection({ type: 'song', songId, variantId })
      setSongMode('preview')
    },
    [selection],
  )

  // Desktop keyboard shortcuts (#178): ↑/↓ move the focus cursor through focusableItems, Enter
  // opens whatever's currently focused, ⌘F/Ctrl+F jumps to the search box from anywhere on the
  // page. Pointer lane only, and never while a dialog is open on top (Enter confirming e.g. a
  // delete prompt shouldn't also act on a focused row underneath it).
  useEffect(() => {
    if (inputCapability !== 'pointer' || dialogOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      // Anywhere the user is actually typing (the search box itself, a rename field, etc.) -
      // arrow keys/Enter there mean "move the text cursor"/"submit this field", not "navigate
      // the list".
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIndex((i) => (i === null ? 0 : Math.min(i + 1, focusableItems.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIndex((i) => (i === null ? 0 : Math.max(i - 1, 0)))
      } else if (e.key === 'Enter' && focusedIndex !== null) {
        const item = focusableItems[focusedIndex]
        if (!item) return
        if (item.type === 'setlist') {
          setSelection(
            selection?.type === 'setlist' && selection.id === item.id ? null : { type: 'setlist', id: item.id },
          )
        } else {
          selectSong(item.id, null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // selection/selectSong both genuinely read inside handleKeyDown's own closure (the setlist
    // toggle-check, and selectSong's own internal one for songs) - leaving them out risked the
    // classic stale-closure bug: Enter acting on an old `selection` value. selectSong is a
    // useCallback keyed on [selection] specifically so this doesn't re-run on every render, only
    // when selection itself actually changes.
  }, [inputCapability, dialogOpen, focusableItems, focusedIndex, selection, selectSong])


  async function createSetlist() {
    const name = await promptText('Neue Setlist', { label: 'Name der neuen Setlist' })
    if (!name?.trim()) return
    const setlist: Setlist = {
      id: randomId(),
      name: name.trim(),
      entries: [],
      createdAt: Date.now(),
    }
    saveSetlist(setlist)
    setSelection({ type: 'setlist', id: setlist.id })
  }

  /** Song creation/deletion moved here from SheetEditor (Marco, explicit request) - the editor
   * is now purely for editing a song that already exists, same as SetlistDetail is purely for
   * editing a setlist that already exists. A brand-new song starts with a title and nothing
   * else; its default variant is created lazily the moment SheetEditor opens it
   * (`ensureDefaultVariant`, same lazy-migration path a pre-variant legacy song already uses). */
  async function createSong() {
    const title = await promptText('Neuer Song', { label: 'Titel des neuen Songs' })
    if (!title?.trim()) return
    const song: Song = {
      id: randomId(),
      title: title.trim(),
      bpm: 120,
      timeSignature: '4/4',
      clickTrackEnabled: false,
      chordProContent: '',
      timecodes: [],
    }
    await saveSong(song)
    // Straight to edit mode, not the preview - there's nothing to preview yet on a brand-new,
    // still-empty song.
    setSelection({ type: 'song', songId: song.id, variantId: null })
    setSongMode('edit')
  }

  async function handleDeleteSong(song: Song) {
    const confirmed = await confirm(`"${song.title || '(ohne Titel)'}" wirklich löschen?`, {
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!confirmed) return
    await removeSong(song.id)
    if (selection?.type === 'song' && selection.songId === song.id) setSelection(null)
  }

  /** Reachable from a song row's pointer-lane context menu (#178) - same prompt shape as
   * SetlistDetail's own handleDuplicate. Stays put on the source song rather than jumping to
   * the copy, same as duplicating a setlist doesn't navigate away from the original either. */
  async function handleDuplicateSong(song: Song) {
    const name = await promptText('Song duplizieren', {
      label: 'Titel der Kopie',
      defaultValue: `${song.title} (Kopie)`,
    })
    if (!name?.trim()) return
    await duplicateSong(song.id, name.trim())
  }

  function addSongToSetlist(setlistId: string, songId: string) {
    const target = setlists.find((s) => s.id === setlistId)
    if (!target) return
    saveSetlist({ ...target, entries: [...target.entries, songEntry(songId)] })
  }

  function showTransientMessage(text: string) {
    setSwipeMessage(text)
    setTimeout(() => setSwipeMessage(null), 2000)
  }

  /** Shared by the swipe gesture and the "+" button (Marco: dragging is natural on touch,
   * awkward with a mouse) - both land on whichever setlist is currently active. */
  function addToActiveSetlist(songId: string) {
    if (!activeSetlist) {
      showTransientMessage('Keine aktive Setlist')
      return
    }
    addSongToSetlist(activeSetlist.id, songId)
    showTransientMessage(`Zu "${activeSetlist.name}" hinzugefügt`)
  }

  function handleDragEnd(event: DragEndEvent) {
    const songId = typeof event.active.id === 'string' ? event.active.id.replace('song:', '') : ''
    if (!songId) return

    if (event.over?.id === SETLIST_DROPZONE_ID && selection?.type === 'setlist') {
      addSongToSetlist(selection.id, songId)
      return
    }

    // This whole handler only runs for a row that could actually start a drag - the
    // pointer/mouse lane disables dragging at the source (DraggableSongRow's own `disabled`
    // on useDraggable), not here, so there's exactly one place deciding whether dragging is
    // even possible rather than two checks that could drift apart.
    if (event.delta.x >= SWIPE_THRESHOLD_PX) {
      addToActiveSetlist(songId)
    }
  }

  // SheetEditor owns its own full-page (`h-dvh`) two-column layout - it can't nest inside
  // this view's right pane without a double-height conflict, so entering edit mode replaces
  // the whole tree with the editor instead (its own "← Bibliothek" button clears the
  // selection entirely, same as leaving a setlist - "Bearbeiten" is a deliberate deep dive,
  // not a mode the back button needs to unwind one step at a time back to the preview).
  if (selection?.type === 'song' && songMode === 'edit') {
    return (
      <SheetEditor
        songId={selection.songId}
        variantId={selection.variantId}
        onBack={() => setSelection(null)}
      />
    )
  }

  return (
    // pointerWithin, not dnd-kit's default rectIntersection: this drags a small song row
    // onto a whole large pane, and rectIntersection compares the *dragged item's* rect
    // against the droppable - confirmed live that it never registers a hit here even with
    // full geometric overlap. pointerWithin checks the pointer's own coordinates instead,
    // which is what "drop it anywhere in this pane" actually means.
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      modifiers={[restrictToHorizontalAxis, clampSwipe]}
      onDragEnd={handleDragEnd}
    >
      {/* Single-focus (list -> pick -> detail) is the base case everywhere (#178) - below the
          panel threshold, there isn't room for both panes side by side: show the tree until
          something is picked, then swap to just the detail pane with a way back. At/above the
          panel threshold (desktop-wide, or a landscape tablet already wide enough), both stay
          visible at once - no need to hide either. */}
      <div
        className={`flex h-dvh gap-3 sb-app-bg p-3 text-ink ${isPanel ? 'grid grid-cols-[minmax(0,1fr)_2fr]' : 'flex-col'}`}
      >
        <div
          className={`min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb ${
            isPanel || !selection ? 'flex' : 'hidden'
          }`}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Songs & Setlists durchsuchen…"
            className="h-12 rounded-sb-sm bg-control px-4 text-base text-ink"
          />

          <div className="flex gap-2">
            {(['all', 'setlists', 'songs'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilterMode(mode)}
                className={`h-10 flex-1 rounded-sb-pill text-sm font-medium ${
                  filterMode === mode
                    ? 'bg-accent text-accent-ink'
                    : 'bg-control text-ink-soft hover:bg-control-hover'
                }`}
              >
                {FILTER_LABEL[mode]}
              </button>
            ))}
          </div>

          {filterMode !== 'songs' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">
                  Setlists
                </h2>
                <button
                  type="button"
                  onClick={createSetlist}
                  className="h-8 rounded-sb-sm bg-control-strong px-3 text-xs hover:bg-control-strong-hover"
                >
                  + Neu
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {filteredSetlists.map((setlist, idx) => (
                  <li key={setlist.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelection(
                          selection?.type === 'setlist' && selection.id === setlist.id
                            ? null
                            : { type: 'setlist', id: setlist.id },
                        )
                      }
                      className={`h-14 w-full rounded-sb-sm px-4 text-left text-base ${
                        selection?.type === 'setlist' && selection.id === setlist.id
                          ? 'bg-accent text-accent-ink'
                          : 'bg-control hover:bg-control-hover'
                      } ${focusedIndex === idx ? 'ring-2 ring-inset ring-accent' : ''}`}
                    >
                      {setlist.name}{' '}
                      <span
                        className={
                          selection?.type === 'setlist' && selection.id === setlist.id
                            ? ''
                            : 'text-ink-faint'
                        }
                      >
                        ({setlist.entries.length})
                      </span>
                      {activeSetlist?.id === setlist.id && (
                        <span
                          className={`ml-2 text-xs font-semibold ${
                            selection?.type === 'setlist' && selection.id === setlist.id
                              ? 'text-accent-ink'
                              : 'text-accent'
                          }`}
                        >
                          ● Aktiv
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filterMode !== 'setlists' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Songs</h2>
                <button
                  type="button"
                  onClick={() => void createSong()}
                  className="h-8 rounded-sb-sm bg-control-strong px-3 text-xs hover:bg-control-strong-hover"
                >
                  + Neu
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {filteredSongs.map((song, idx) => (
                  <DraggableSongRow
                    key={song.id}
                    song={song}
                    onClick={() => selectSong(song.id, null)}
                    selected={selection?.type === 'song' && selection.songId === song.id}
                    onAddToActiveSetlist={activeSetlist ? () => addToActiveSetlist(song.id) : null}
                    showAddButton={inputCapability === 'pointer'}
                    showSwipeReveal={inputCapability === 'touch'}
                    pinned={pinnedSongIds.includes(song.id)}
                    onTogglePin={() => togglePin(workspaceId, song.id)}
                    onDuplicate={() => void handleDuplicateSong(song)}
                    onDelete={() => void handleDeleteSong(song)}
                    // Songs come after setlists in focusableItems whenever the current filter
                    // shows both - same offset, same order, so the two stay in sync.
                    keyboardFocused={focusedIndex === (filterMode !== 'songs' ? filteredSetlists.length : 0) + idx}
                  />
                ))}
              </ul>
              {inputCapability === 'pointer' && (
                <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-2 text-xs text-ink-faint">
                  <span>
                    <kbd className="rounded border border-line px-1 font-mono">↑↓</kbd> Liste
                  </span>
                  <span>
                    <kbd className="rounded border border-line px-1 font-mono">⏎</kbd> Öffnen
                  </span>
                  <span>
                    <kbd className="rounded border border-line px-1 font-mono">⌘F</kbd> Suche
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        <div
          ref={setDropzoneRef}
          className={`min-h-0 flex-1 flex-col overflow-hidden rounded-sb border p-4 shadow-sb ${
            isPanel || selection ? 'flex' : 'hidden'
          } ${isOver ? 'border-accent bg-surface' : 'border-line bg-surface'}`}
        >
          {selection?.type === 'setlist' ? (
            <>
              <button
                type="button"
                onClick={() => setSelection(null)}
                className={`mb-3 h-10 self-start rounded-sb-sm bg-control-strong px-4 text-sm hover:bg-control-strong-hover ${
                  isPanel ? 'hidden' : ''
                }`}
              >
                ← Bibliothek
              </button>
              <SetlistDetail
                setlistId={selection.id}
                onSelectSong={selectSong}
                onDeleted={() => setSelection(null)}
              />
            </>
          ) : selection?.type === 'song' ? (
            <>
              <button
                type="button"
                onClick={() => setSelection(null)}
                className={`mb-3 h-10 self-start rounded-sb-sm bg-control-strong px-4 text-sm hover:bg-control-strong-hover ${
                  isPanel ? 'hidden' : ''
                }`}
              >
                ← Bibliothek
              </button>
              <SongPreview
                songId={selection.songId}
                variantId={selection.variantId}
                onEdit={() => setSongMode('edit')}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-ink-faint">
              Wähle links eine Setlist oder einen Song aus.
            </div>
          )}
        </div>
      </div>

      {/* Fixed overlay, not part of either pane's own flow (Marco, explicit request) - it used
          to sit inline above the Setlists/Songs sections, so it shifted that whole list down
          every time it appeared/disappeared. Floats centered near the bottom of the screen
          instead, like a toast, and never intercepts touches/clicks meant for whatever's
          underneath it. */}
      {swipeMessage && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <p className="rounded-sb-pill bg-control-strong px-4 py-2 text-center text-sm text-ink shadow-sb">
            {swipeMessage}
          </p>
        </div>
      )}
    </DndContext>
  )
}

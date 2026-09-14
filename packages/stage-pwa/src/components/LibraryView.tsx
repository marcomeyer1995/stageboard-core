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
import { useMemo, useState } from 'react'
import type { Setlist, Song } from 'shared-types'
import { randomId } from '../lib/id'
import { useQueue } from '../lib/queue'
import { useInputCapability } from '../lib/useInputCapability'
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
 * rather than an aborted drag - well past the sensor's own activation distance. */
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
  /** Confirmation lives in the caller (matches every other delete flow in the app) - this is
   * called only once the user has already said yes. */
  onDelete: () => void
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
  onDelete,
}: DraggableSongRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `song:${song.id}`,
    // Drag/swipe is a touch-only gesture now (Marco, explicit request) - the pointer/mouse
    // lane has the "+" button instead, so there's no drag left to disambiguate there at all,
    // not even the "drop directly onto an open setlist pane" case #191 still allowed.
    disabled: !showSwipeReveal,
  })

  return (
    <li className="relative overflow-hidden rounded-sb-sm">
      {/* Revealed by the row above sliding right - a solid row background at rest fully
          covers this, so no opacity/width math is needed to fake the Spotify swipe-reveal.
          Touch lane only - a mouse user dragging onto an open setlist pane isn't "swiping to
          the active setlist" at all, so this message would just be wrong for them. */}
      {showSwipeReveal && (
        <div className="absolute inset-0 flex items-center bg-accent-2 px-4 text-sm font-medium text-accent-ink">
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
        }`}
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
          actions={[
            { label: pinned ? 'Offline-Pin entfernen' : 'Offline anheften', onClick: onTogglePin },
            { label: 'Löschen', danger: true, onClick: onDelete },
          ]}
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
  const removeSong = useSongsStore((state) => state.remove)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const { activeSetlist } = useQueue()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const pinnedSongIds = useAudioPinsStore((state) => state.pinsFor(workspaceId))
  const togglePin = useAudioPinsStore((state) => state.togglePin)
  const promptText = useDialogStore((state) => state.promptText)
  const confirm = useDialogStore((state) => state.confirm)
  const inputCapability = useInputCapability()
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [selection, setSelection] = useState<Selection>(null)
  // A song selection always starts in 'preview' (SongPreview, in the right pane) - 'edit' only
  // once its "Bearbeiten" button is clicked, which is what actually opens the full-page
  // SheetEditor. Irrelevant while selection isn't a song.
  const [songMode, setSongMode] = useState<'preview' | 'edit'>('preview')
  const [swipeMessage, setSwipeMessage] = useState<string | null>(null)

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

  /** Shared by the song row's own click and SetlistDetail's onSelectSong - both land on the
   * preview, never straight on the editor. Clicking the already-selected song again closes
   * the preview instead of re-opening it (Marco, explicit request, same toggle as a setlist
   * below) - only reachable from the Bibliothek's own row today, since selecting a song from
   * inside a setlist replaces that setlist's own view entirely, so there's no "already
   * selected" row left showing to re-click there. */
  function selectSong(songId: string, variantId: string | null) {
    if (selection?.type === 'song' && selection.songId === songId && selection.variantId === variantId) {
      setSelection(null)
      return
    }
    setSelection({ type: 'song', songId, variantId })
    setSongMode('preview')
  }

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
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={handleDragEnd}
    >
      {/* Below lg (tablet portrait and phones - docs/07's "phone"/"tablet portrait" classes),
          there isn't room for both panes side by side: show the tree until something is
          picked, then swap to just the detail pane with a way back. At lg and up, both stay
          visible at once - no need to hide either. */}
      <div className="flex h-dvh flex-col gap-3 sb-app-bg p-3 text-ink lg:grid lg:grid-cols-[minmax(0,1fr)_2fr]">
        <div
          className={`flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb lg:flex ${
            selection ? 'hidden' : 'flex'
          }`}
        >
          <input
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

          {swipeMessage && (
            <p className="rounded-sb-sm bg-control-strong px-3 py-2 text-center text-sm text-ink">
              {swipeMessage}
            </p>
          )}

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
                {filteredSetlists.map((setlist) => (
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
                      }`}
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
                {filteredSongs.map((song) => (
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
                    onDelete={() => void handleDeleteSong(song)}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>

        <div
          ref={setDropzoneRef}
          className={`flex-col overflow-y-auto rounded-sb border p-4 shadow-sb lg:flex ${
            selection ? 'flex' : 'hidden'
          } ${isOver ? 'border-accent bg-surface' : 'border-line bg-surface'}`}
        >
          {selection?.type === 'setlist' ? (
            <>
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="mb-3 h-10 self-start rounded-sb-sm bg-control-strong px-4 text-sm hover:bg-control-strong-hover lg:hidden"
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
                className="mb-3 h-10 self-start rounded-sb-sm bg-control-strong px-4 text-sm hover:bg-control-strong-hover lg:hidden"
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
    </DndContext>
  )
}

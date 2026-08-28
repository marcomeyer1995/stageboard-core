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
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'
import type { Setlist, Song } from 'shared-types'
import { randomId } from '../lib/id'
import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'
import { SetlistDetail } from './SetlistDetail'
import { SheetEditor } from './SheetEditor'

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
  return { id: randomId(), songId, variantId: null as string | null }
}

function DraggableSongRow({ song, onClick }: { song: Song; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `song:${song.id}`,
  })

  return (
    <li className="relative overflow-hidden rounded-sb-sm">
      {/* Revealed by the row above sliding right - a solid row background at rest fully
          covers this, so no opacity/width math is needed to fake the Spotify swipe-reveal. */}
      <div className="absolute inset-0 flex items-center bg-accent-2 px-4 text-sm font-medium text-accent-ink">
        + Zur aktiven Setlist
      </div>
      <button
        ref={setNodeRef}
        type="button"
        onClick={onClick}
        {...listeners}
        {...attributes}
        style={{
          transform: CSS.Translate.toString(transform),
          transition: isDragging ? undefined : 'transform 200ms ease',
        }}
        className="relative z-10 w-full truncate rounded-sb-sm bg-control px-4 py-3 text-left text-base hover:bg-control-hover"
      >
        {song.title || '(ohne Titel)'}
        {song.artist && <span className="text-ink-faint"> — {song.artist}</span>}
      </button>
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
 * activate); clicking any song opens SheetEditor on exactly that song+variant.
 */
export function LibraryView() {
  const songs = useSongsStore((state) => state.songs)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const { activeSetlist } = useQueue()
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [selection, setSelection] = useState<Selection>(null)
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

  function createSetlist() {
    const name = window.prompt('Name der neuen Setlist?')
    if (!name?.trim()) return
    const setlist: Setlist = {
      id: randomId(),
      name: name.trim(),
      entries: songs.map((song) => songEntry(song.id)),
      createdAt: Date.now(),
    }
    saveSetlist(setlist)
    setSelection({ type: 'setlist', id: setlist.id })
  }

  function addSongToSetlist(setlistId: string, songId: string) {
    const target = setlists.find((s) => s.id === setlistId)
    if (!target) return
    saveSetlist({ ...target, entries: [...target.entries, songEntry(songId)] })
  }

  function handleDragEnd(event: DragEndEvent) {
    const songId = typeof event.active.id === 'string' ? event.active.id.replace('song:', '') : ''
    if (!songId) return

    if (event.over?.id === SETLIST_DROPZONE_ID && selection?.type === 'setlist') {
      addSongToSetlist(selection.id, songId)
      return
    }

    if (event.delta.x >= SWIPE_THRESHOLD_PX) {
      if (!activeSetlist) {
        setSwipeMessage('Keine aktive Setlist')
        setTimeout(() => setSwipeMessage(null), 2000)
        return
      }
      addSongToSetlist(activeSetlist.id, songId)
      setSwipeMessage(`Zu "${activeSetlist.name}" hinzugefügt`)
      setTimeout(() => setSwipeMessage(null), 2000)
    }
  }

  // SheetEditor owns its own full-page (`h-dvh`) two-column layout - it can't nest inside
  // this view's right pane without a double-height conflict, so selecting a song replaces
  // the whole tree with the editor instead (a "← Bibliothek" button gets back).
  if (selection?.type === 'song') {
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
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
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
                      onClick={() => setSelection({ type: 'setlist', id: setlist.id })}
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
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filterMode !== 'setlists' && (
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Songs</h2>
              <ul className="flex flex-col gap-1">
                {filteredSongs.map((song) => (
                  <DraggableSongRow
                    key={song.id}
                    song={song}
                    onClick={() => setSelection({ type: 'song', songId: song.id, variantId: null })}
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
                onSelectSong={(songId, variantId) =>
                  setSelection({ type: 'song', songId, variantId })
                }
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

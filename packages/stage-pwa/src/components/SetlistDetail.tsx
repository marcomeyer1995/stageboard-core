import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import { useQueue } from '../lib/queue'
import { randomId } from '../lib/id'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

interface SetlistDetailProps {
  setlistId: string
  /** Drives LibraryView's right pane over to SheetEditor for that song - `null` variantId
   * means "the song's default variant", same convention SetlistEntry itself uses. */
  onSelectSong: (songId: string, variantId: string | null) => void
}

interface EntryRowProps {
  entry: SetlistEntry
  index: number
  song: Song | undefined
  songVariants: SongVariant[]
  onSelectSong: (songId: string, variantId: string | null) => void
  onSetVariant: (entryId: string, variantId: string) => void
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (index: number) => void
}

/** A grip handle carries the drag listeners, not the row itself - the song title stays a
 * plain clickable button and the variant `<select>` stays a plain select, neither fighting
 * a drag gesture that would otherwise be listening on the same element. */
function EntryRow({
  entry,
  index,
  song,
  songVariants,
  onSelectSong,
  onSetVariant,
  onMove,
  onRemove,
}: EntryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  })
  const selectedVariantId = entry.variantId ?? songVariants.find((v) => v.isDefault)?.id ?? ''

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-sb-sm bg-control px-3 py-3 text-base ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className="flex h-10 w-8 flex-shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        aria-label="Ziehen zum Sortieren"
      >
        ⠿
      </button>
      <button
        type="button"
        onClick={() => onSelectSong(entry.songId, entry.variantId)}
        className="min-w-0 flex-1 truncate text-left hover:underline"
      >
        {index + 1}. {song?.title ?? '(unbekannter Song)'}
      </button>
      {songVariants.length > 1 && (
        <select
          value={selectedVariantId}
          onChange={(e) => onSetVariant(entry.id, e.target.value)}
          className="h-10 rounded-sb-sm bg-control-strong px-2 text-sm text-ink"
        >
          {songVariants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
            </option>
          ))}
        </select>
      )}
      <span className="flex flex-shrink-0 gap-1">
        <button
          type="button"
          onClick={() => onMove(index, -1)}
          className="h-10 w-10 rounded-sb-sm bg-control-strong hover:bg-control-strong-hover"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(index, 1)}
          className="h-10 w-10 rounded-sb-sm bg-control-strong hover:bg-control-strong-hover"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="h-10 w-10 rounded-sb-sm bg-control-strong hover:bg-control-strong-hover"
        >
          ×
        </button>
      </span>
    </li>
  )
}

/**
 * The management pane for one setlist - reorder (drag handle, or the up/down arrows - #20
 * refinement added drag without removing the existing, already-accessible arrows), remove
 * entries, pick a per-entry variant, add songs, duplicate, activate. Extracted from the old
 * standalone SetlistManager (#20) so LibraryView's unified tree can reuse it as the
 * right-pane detail view for "click a setlist" - the list-of-all-setlists half of that
 * component lives in LibraryView now.
 */
export function SetlistDetail({ setlistId, onSelectSong }: SetlistDetailProps) {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const duplicateSetlist = useSetlistsStore((state) => state.duplicateSetlist)
  const { activeSetlist, isMaster } = useQueue()
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const setlist = setlists.find((s) => s.id === setlistId) ?? null

  async function handleDuplicate() {
    if (!setlist) return
    const name = window.prompt('Name der Kopie?', `${setlist.name} (Kopie)`)
    if (!name?.trim()) return
    await duplicateSetlist(setlist.id, name.trim())
  }

  function moveSong(index: number, direction: -1 | 1) {
    if (!setlist) return
    const target = index + direction
    if (target < 0 || target >= setlist.entries.length) return
    const entries = [...setlist.entries]
    ;[entries[index], entries[target]] = [entries[target], entries[index]]
    saveSetlist({ ...setlist, entries })
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!setlist || !event.over || event.active.id === event.over.id) return
    const from = setlist.entries.findIndex((e) => e.id === event.active.id)
    const to = setlist.entries.findIndex((e) => e.id === event.over?.id)
    if (from === -1 || to === -1) return
    saveSetlist({ ...setlist, entries: arrayMove(setlist.entries, from, to) })
  }

  function removeSong(index: number) {
    if (!setlist) return
    saveSetlist({ ...setlist, entries: setlist.entries.filter((_, i) => i !== index) })
  }

  /** Adds a new occurrence of a song - deliberately allowed even if the song is already in
   * the setlist, so e.g. a shortened "Kurzfassung" can be added as an encore of a song that
   * already played earlier in its full-length variant. */
  function addSong(songId: string) {
    if (!setlist || !songId) return
    saveSetlist({
      ...setlist,
      entries: [...setlist.entries, { id: randomId(), songId, variantId: null }],
    })
  }

  function setVariant(entryId: string, variantId: string) {
    if (!setlist) return
    saveSetlist({
      ...setlist,
      entries: setlist.entries.map((entry) =>
        entry.id === entryId ? { ...entry, variantId } : entry,
      ),
    })
  }

  if (!setlist) {
    return <p className="text-ink-faint">Setlist wurde entfernt.</p>
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
          {setlist.name}
        </h2>
        <span className="flex flex-shrink-0 gap-1">
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            className="h-10 rounded-sb-sm bg-control-strong px-3 text-sm hover:bg-control-strong-hover"
          >
            Duplizieren
          </button>
          <button
            type="button"
            onClick={() => setActiveSetlist(setlist.id)}
            disabled={!isMaster}
            className="h-10 rounded-sb-sm bg-accent-2 px-3 text-sm font-medium text-accent-ink hover:bg-accent-2-hover disabled:opacity-40"
          >
            Aktivieren
          </button>
        </span>
      </div>
      {activeSetlist?.id === setlist.id && (
        <button
          type="button"
          onClick={() => setActiveSetlist(null)}
          disabled={!isMaster}
          className="h-10 self-start rounded-sb-sm bg-control-strong px-3 text-sm hover:bg-control-strong-hover disabled:opacity-40"
        >
          Setlist deaktivieren (alle Songs)
        </button>
      )}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={setlist.entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {setlist.entries.map((entry, index) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                index={index}
                song={songs.find((s) => s.id === entry.songId)}
                songVariants={variants.filter((v) => v.songId === entry.songId)}
                onSelectSong={onSelectSong}
                onSetVariant={setVariant}
                onMove={moveSong}
                onRemove={removeSong}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Song hinzufügen
        <select
          className="h-12 rounded-sb-sm bg-control px-2 text-base text-ink"
          value=""
          onChange={(e) => addSong(e.target.value)}
        >
          <option value="" disabled>
            Song wählen...
          </option>
          {songs.map((song) => (
            <option key={song.id} value={song.id}>
              {song.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

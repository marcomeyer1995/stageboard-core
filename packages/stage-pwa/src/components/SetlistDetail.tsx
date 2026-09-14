import { useEffect, useRef, useState } from 'react'
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
import { useDialogStore } from '../store/useDialogStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { OverflowMenu } from './OverflowMenu'

interface SetlistDetailProps {
  setlistId: string
  /** Drives LibraryView's right pane over to SheetEditor for that song - `null` variantId
   * means "the song's default variant", same convention SetlistEntry itself uses. */
  onSelectSong: (songId: string, variantId: string | null) => void
  /** Called after the setlist is actually deleted, so LibraryView can clear a selection
   * that would otherwise point at a setlist that no longer exists. */
  onDeleted: () => void
}

interface EntryRowProps {
  entry: SetlistEntry
  index: number
  song: Song | undefined
  songVariants: SongVariant[]
  onSelectSong: (songId: string, variantId: string | null) => void
  onSetVariant: (entryId: string, variantId: string) => void
  onRemove: (index: number) => void
}

/** A grip handle carries the drag listeners, not the row itself - the song title stays a
 * plain clickable button and the variant `<select>` stays a plain select, neither fighting
 * a drag gesture that would otherwise be listening on the same element. Drag is the only
 * reorder gesture (Marco, explicit request: the row menu's own "Nach oben"/"Nach unten" from
 * #181 went unused once drag existed, so they were removed rather than kept as a redundant
 * second way to do the same thing) - the ⋯ menu is Entfernen only. */
function EntryRow({
  entry,
  index,
  song,
  songVariants,
  onSelectSong,
  onSetVariant,
  onRemove,
}: EntryRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  })
  const selectedVariantId = entry.variantId ?? songVariants.find((v) => v.isDefault)?.id ?? ''
  const title = song?.title ?? '(unbekannter Song)'

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
        {index + 1}. {title}
      </button>
      {songVariants.length > 1 && (
        // A long variant label (e.g. an auto-detection tool's full name) otherwise sizes the
        // closed <select> to fit itself, squeezing the title button down to almost nothing
        // (Marco, live screenshot: "Wie ein s..." with the rest cut off). Fixed, capped width
        // instead - w-32 comfortably fits a short label like "Original" in full and ellipsizes
        // a longer one; the dropdown's own open options still show full text either way.
        <select
          value={selectedVariantId}
          onChange={(e) => onSetVariant(entry.id, e.target.value)}
          className="h-10 w-32 min-w-0 flex-shrink-0 truncate rounded-sb-sm bg-control-strong px-2 text-sm text-ink"
        >
          {songVariants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.label}
            </option>
          ))}
        </select>
      )}
      {/* flat, not the default boxed pill - same unboxed treatment LibraryView.tsx's own song
          rows already use for their ⋯ (Marco, explicit request: match "the left ones"). */}
      <OverflowMenu
        title={title}
        variant="flat"
        actions={[{ label: 'Entfernen', danger: true, onClick: () => onRemove(index) }]}
      />
    </li>
  )
}

/** A plain `<select>` doesn't let you type to filter its own options - this is a small
 * hand-rolled combobox instead (text input + a dropdown of matches below it), same
 * title/artist substring match LibraryView.tsx's own search box already uses. Opening it
 * (focus) shows every song; typing narrows the list; picking one adds it and resets. Closes on
 * Escape or a click outside - `mousedown`, not `click`, so it fires before a dropdown button's
 * own click would otherwise be pre-empted by an intervening blur. */
function AddSongCombobox({ songs, onAdd }: { songs: Song[]; onAdd: (songId: string) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const term = query.trim().toLowerCase()
  const filtered = term
    ? songs.filter((s) => s.title.toLowerCase().includes(term) || s.artist?.toLowerCase().includes(term))
    : songs

  function pick(songId: string) {
    onAdd(songId)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1 text-sm text-ink-muted">
      Song hinzufügen
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Songs durchsuchen…"
        className="h-12 rounded-sb-sm bg-control px-4 text-base text-ink placeholder:text-ink-faint"
      />
      {open && (
        // Opens upward, not down (Marco, explicit request) - this control sits at the bottom
        // of the pane, below the entry list, so a downward dropdown pushed itself off-screen
        // and needed a scroll to reach; anchoring to the input's top edge instead opens into
        // the room the entry list already occupies.
        <ul className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-64 overflow-y-auto rounded-sb border border-line bg-surface shadow-sb">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-faint">Keine Songs gefunden.</li>
          ) : (
            filtered.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  onClick={() => pick(song.id)}
                  className="block w-full truncate px-4 py-3 text-left text-base text-ink hover:bg-control-hover"
                >
                  {song.title || '(ohne Titel)'}
                  {song.artist && <span className="text-ink-faint"> — {song.artist}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * The management pane for one setlist - reorder (drag), remove entries, pick a per-entry
 * variant, add songs, rename, duplicate, activate. Extracted from the
 * old standalone SetlistManager (#20) so LibraryView's unified tree can reuse it as the
 * right-pane detail view for "click a setlist" - the list-of-all-setlists half of that
 * component lives in LibraryView now.
 */
export function SetlistDetail({ setlistId, onSelectSong, onDeleted }: SetlistDetailProps) {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const duplicateSetlist = useSetlistsStore((state) => state.duplicateSetlist)
  const removeSetlist = useSetlistsStore((state) => state.remove)
  const promptText = useDialogStore((state) => state.promptText)
  const confirm = useDialogStore((state) => state.confirm)
  const { activeSetlist, isMaster } = useQueue()
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const setlist = setlists.find((s) => s.id === setlistId) ?? null

  async function handleRename() {
    if (!setlist) return
    const name = await promptText('Setlist umbenennen', { label: 'Neuer Name', defaultValue: setlist.name })
    if (!name?.trim()) return
    saveSetlist({ ...setlist, name: name.trim() })
  }

  async function handleDuplicate() {
    if (!setlist) return
    const name = await promptText('Setlist duplizieren', {
      label: 'Name der Kopie',
      defaultValue: `${setlist.name} (Kopie)`,
    })
    if (!name?.trim()) return
    await duplicateSetlist(setlist.id, name.trim())
  }

  async function handleDelete() {
    if (!setlist) return
    const confirmed = await confirm(
      `"${setlist.name}" wirklich löschen? Das kann nicht rückgängig gemacht werden.`,
      { confirmLabel: 'Löschen', danger: true },
    )
    if (!confirmed) {
      return
    }
    // Deleting the active setlist shouldn't leave ShowState pointing at a document that no
    // longer exists - the app already tolerates that (this same file's own "Setlist wurde
    // entfernt" fallback), but clearing it here is the cleaner outcome for whoever's
    // watching the queue elsewhere (e.g. NextSongWidget) right as this happens.
    if (activeSetlist?.id === setlist.id && isMaster) {
      await setActiveSetlist(null)
    }
    await removeSetlist(setlist.id)
    onDeleted()
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
      entries: [...setlist.entries, { id: randomId(), songId, variantId: null, trackId: null }],
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
    // flex-1/min-h-0, not h-full: this sits beside LibraryView's mobile-only "← Bibliothek"
    // button (a sibling in the same flex-col pane, not a fixed-height container of its own),
    // so h-full would claim 100% of the pane and overflow by the button's own height whenever
    // that button is actually visible (Marco: the whole page was scrolling in portrait mode,
    // not just this list) - flex-1 instead claims only what's left after the button.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-ink-muted">
          {setlist.name}
          {activeSetlist?.id === setlist.id && (
            <span className="text-xs font-semibold normal-case text-accent">● Aktiv</span>
          )}
        </h2>
        <span className="flex flex-shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setActiveSetlist(setlist.id)}
            disabled={!isMaster}
            className="h-10 rounded-sb-sm bg-accent-2 px-3 text-sm font-medium text-accent-ink hover:bg-accent-2-hover disabled:opacity-40"
          >
            Aktivieren
          </button>
          {/* Duplizieren/Löschen behind one menu, same pattern as a song row's own ⋯ in
              LibraryView.tsx - harmonizing how a song vs. a setlist gets deleted (Marco,
              explicit request). Aktivieren stays its own always-visible button: it's the one
              action reached for constantly during a show, unlike the other two. */}
          <OverflowMenu
            title={setlist.name}
            actions={[
              { label: 'Umbenennen', onClick: () => void handleRename() },
              { label: 'Duplizieren', onClick: () => void handleDuplicate() },
              { label: 'Löschen', danger: true, onClick: () => void handleDelete() },
            ]}
          />
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
                onRemove={removeSong}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AddSongCombobox songs={songs} onAdd={addSong} />
    </div>
  )
}

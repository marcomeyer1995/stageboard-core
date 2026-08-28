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

/**
 * The management pane for one setlist - reorder/remove entries, pick a per-entry variant,
 * add songs, duplicate, activate. Extracted from the old standalone SetlistManager (#20) so
 * LibraryView's unified tree can reuse it as the right-pane detail view for "click a
 * setlist" - the list-of-all-setlists half of that component lives in LibraryView now.
 */
export function SetlistDetail({ setlistId, onSelectSong }: SetlistDetailProps) {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const duplicateSetlist = useSetlistsStore((state) => state.duplicateSetlist)
  const { activeSetlist, isMaster } = useQueue()
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)

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
            className="rounded-sb-sm bg-control-strong px-2 py-0.5 text-xs hover:bg-control-strong-hover"
          >
            Duplizieren
          </button>
          <button
            type="button"
            onClick={() => setActiveSetlist(setlist.id)}
            disabled={!isMaster}
            className="rounded-sb-sm bg-accent-2 px-2 py-0.5 text-xs font-medium text-accent-ink hover:bg-accent-2-hover disabled:opacity-40"
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
          className="self-start rounded-sb-sm bg-control-strong px-2 py-1 text-xs hover:bg-control-strong-hover disabled:opacity-40"
        >
          Setlist deaktivieren (alle Songs)
        </button>
      )}
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {setlist.entries.map((entry, index) => {
          const song = songs.find((s) => s.id === entry.songId)
          const songVariants = variants.filter((v) => v.songId === entry.songId)
          const selectedVariantId =
            entry.variantId ?? songVariants.find((v) => v.isDefault)?.id ?? ''
          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-3 py-2 text-sm"
            >
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
                  onChange={(e) => setVariant(entry.id, e.target.value)}
                  className="rounded-sb-sm bg-control-strong px-1 py-0.5 text-xs text-ink"
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
                  onClick={() => moveSong(index, -1)}
                  className="rounded-sb-sm bg-control-strong px-2 hover:bg-control-strong-hover"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveSong(index, 1)}
                  className="rounded-sb-sm bg-control-strong px-2 hover:bg-control-strong-hover"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeSong(index)}
                  className="rounded-sb-sm bg-control-strong px-2 hover:bg-control-strong-hover"
                >
                  ×
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <label className="flex flex-col gap-1 text-sm text-ink-muted">
        Song hinzufügen
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-ink"
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

import { useState } from 'react'
import type { Setlist } from 'shared-types'
import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { randomId } from '../lib/id'

export function SetlistManager() {
  const songs = useSongsStore((state) => state.songs)
  const variants = useSongVariantsStore((state) => state.variants)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const duplicateSetlist = useSetlistsStore((state) => state.duplicateSetlist)
  const { activeSetlist, isMaster } = useQueue()
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = setlists.find((setlist) => setlist.id === selectedId) ?? null

  function createSetlist() {
    const name = window.prompt('Name der neuen Setlist?')
    if (!name?.trim()) return
    const setlist: Setlist = {
      id: randomId(),
      name: name.trim(),
      entries: songs.map((song) => ({ id: randomId(), songId: song.id, variantId: null })),
    }
    saveSetlist(setlist)
    setSelectedId(setlist.id)
  }

  async function handleDuplicate(id: string) {
    const source = setlists.find((setlist) => setlist.id === id)
    const name = window.prompt('Name der Kopie?', source ? `${source.name} (Kopie)` : undefined)
    if (!name?.trim()) return
    const copy = await duplicateSetlist(id, name.trim())
    if (copy) setSelectedId(copy.id)
  }

  function moveSong(index: number, direction: -1 | 1) {
    if (!selected) return
    const target = index + direction
    if (target < 0 || target >= selected.entries.length) return
    const entries = [...selected.entries]
    ;[entries[index], entries[target]] = [entries[target], entries[index]]
    saveSetlist({ ...selected, entries })
  }

  function removeSong(index: number) {
    if (!selected) return
    saveSetlist({ ...selected, entries: selected.entries.filter((_, i) => i !== index) })
  }

  /** Adds a new occurrence of a song - deliberately allowed even if the song is already in
   * the setlist, so e.g. a shortened "Kurzfassung" can be added as an encore of a song that
   * already played earlier in its full-length variant. */
  function addSong(songId: string) {
    if (!selected || !songId) return
    saveSetlist({
      ...selected,
      entries: [...selected.entries, { id: randomId(), songId, variantId: null }],
    })
  }

  function setVariant(entryId: string, variantId: string) {
    if (!selected) return
    saveSetlist({
      ...selected,
      entries: selected.entries.map((entry) =>
        entry.id === entryId ? { ...entry, variantId } : entry,
      ),
    })
  }

  return (
    <div className="grid h-dvh grid-cols-2 gap-3 sb-app-bg p-3 text-ink">
      <div className="flex flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
            Setlists
          </h2>
          <button
            type="button"
            onClick={createSetlist}
            className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs hover:bg-control-strong-hover"
          >
            + Neu
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {setlists.map((setlist) => (
            <li
              key={setlist.id}
              className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-3 py-2 text-sm"
            >
              <button
                type="button"
                onClick={() => setSelectedId(setlist.id)}
                className="flex-1 text-left hover:underline"
              >
                {setlist.name} <span className="text-ink-faint">({setlist.entries.length})</span>
                {activeSetlist?.id === setlist.id && (
                  <span className="ml-2 text-xs text-accent">● aktiv</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(setlist.id)}
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
            </li>
          ))}
        </ul>
        {activeSetlist && (
          <button
            type="button"
            onClick={() => setActiveSetlist(null)}
            disabled={!isMaster}
            className="self-start rounded-sb-sm bg-control-strong px-2 py-1 text-xs hover:bg-control-strong-hover disabled:opacity-40"
          >
            Setlist deaktivieren (alle Songs)
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb">
        {selected ? (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
              {selected.name}
            </h2>
            <ul className="flex flex-col gap-1">
              {selected.entries.map((entry, index) => {
                const song = songs.find((s) => s.id === entry.songId)
                const songVariants = variants.filter((v) => v.songId === entry.songId)
                const selectedVariantId =
                  entry.variantId ?? songVariants.find((v) => v.isDefault)?.id ?? ''
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-sb-sm bg-control px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {index + 1}. {song?.title ?? '(unbekannter Song)'}
                    </span>
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
          </>
        ) : (
          <p className="text-ink-faint">Wähle links eine Setlist aus.</p>
        )}
      </div>
    </div>
  )
}

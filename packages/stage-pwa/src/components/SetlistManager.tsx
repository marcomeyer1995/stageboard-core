import { useState } from 'react'
import type { Setlist } from 'shared-types'
import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'

export function SetlistManager() {
  const songs = useSongsStore((state) => state.songs)
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
      id: crypto.randomUUID(),
      name: name.trim(),
      songIds: songs.map((song) => song.id),
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
    if (target < 0 || target >= selected.songIds.length) return
    const songIds = [...selected.songIds]
    ;[songIds[index], songIds[target]] = [songIds[target], songIds[index]]
    saveSetlist({ ...selected, songIds })
  }

  function removeSong(index: number) {
    if (!selected) return
    saveSetlist({ ...selected, songIds: selected.songIds.filter((_, i) => i !== index) })
  }

  function addSong(songId: string) {
    if (!selected || !songId || selected.songIds.includes(songId)) return
    saveSetlist({ ...selected, songIds: [...selected.songIds, songId] })
  }

  return (
    <div className="grid h-screen grid-cols-2 gap-3 bg-black p-3 text-white">
      <div className="flex flex-col gap-3 overflow-y-auto rounded-lg bg-neutral-900 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-400">
            Setlists
          </h2>
          <button
            type="button"
            onClick={createSetlist}
            className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
          >
            + Neu
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {setlists.map((setlist) => (
            <li
              key={setlist.id}
              className="flex items-center justify-between gap-2 rounded bg-neutral-800 px-3 py-2 text-sm"
            >
              <button
                type="button"
                onClick={() => setSelectedId(setlist.id)}
                className="flex-1 text-left hover:underline"
              >
                {setlist.name} <span className="text-neutral-500">({setlist.songIds.length})</span>
                {activeSetlist?.id === setlist.id && (
                  <span className="ml-2 text-xs text-amber-400">● aktiv</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDuplicate(setlist.id)}
                className="rounded bg-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-600"
              >
                Duplizieren
              </button>
              <button
                type="button"
                onClick={() => setActiveSetlist(setlist.id)}
                disabled={!isMaster}
                className="rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-black hover:bg-amber-400 disabled:opacity-40"
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
            className="self-start rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600 disabled:opacity-40"
          >
            Setlist deaktivieren (alle Songs)
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto rounded-lg bg-neutral-900 p-4">
        {selected ? (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-400">
              {selected.name}
            </h2>
            <ul className="flex flex-col gap-1">
              {selected.songIds.map((songId, index) => {
                const song = songs.find((s) => s.id === songId)
                return (
                  <li
                    key={`${songId}-${index}`}
                    className="flex items-center justify-between gap-2 rounded bg-neutral-800 px-3 py-2 text-sm"
                  >
                    <span>
                      {index + 1}. {song?.title ?? '(unbekannter Song)'}
                    </span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveSong(index, -1)}
                        className="rounded bg-neutral-700 px-2 hover:bg-neutral-600"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSong(index, 1)}
                        className="rounded bg-neutral-700 px-2 hover:bg-neutral-600"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSong(index)}
                        className="rounded bg-neutral-700 px-2 hover:bg-neutral-600"
                      >
                        ×
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
            <label className="flex flex-col gap-1 text-sm text-neutral-400">
              Song hinzufügen
              <select
                className="rounded bg-neutral-800 px-2 py-1 text-white"
                value=""
                onChange={(e) => addSong(e.target.value)}
              >
                <option value="" disabled>
                  Song wählen...
                </option>
                {songs
                  .filter((song) => !selected.songIds.includes(song.id))
                  .map((song) => (
                    <option key={song.id} value={song.id}>
                      {song.title}
                    </option>
                  ))}
              </select>
            </label>
          </>
        ) : (
          <p className="text-neutral-500">Wähle links eine Setlist aus.</p>
        )}
      </div>
    </div>
  )
}

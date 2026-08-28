import { useMemo, useState } from 'react'
import type { Setlist } from 'shared-types'
import { randomId } from '../lib/id'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'
import { SetlistDetail } from './SetlistDetail'
import { SheetEditor } from './SheetEditor'

type Selection =
  | { type: 'setlist'; id: string }
  | { type: 'song'; songId: string; variantId: string | null }
  | null

/**
 * The "Bibliothek" (#20): a search-driven tree over Setlists and Songs, replacing the old
 * separate 'edit'/'setlists' modes. Clicking a setlist shows its songs (via SetlistDetail,
 * which still owns all the actual setlist-management logic - reorder, variant pick, add/
 * remove, duplicate, activate); clicking any song - from a setlist or the flat catalog below
 * it - opens SheetEditor on exactly that song+variant. Nothing selected yet falls back to
 * SheetEditor's own default (self-contained) behavior, same as the old standalone 'edit' mode.
 */
export function LibraryView() {
  const songs = useSongsStore((state) => state.songs)
  const setlists = useSetlistsStore((state) => state.setlists)
  const saveSetlist = useSetlistsStore((state) => state.saveSetlist)
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState<Selection>(null)

  const term = search.trim().toLowerCase()
  const filteredSetlists = useMemo(
    () => (term ? setlists.filter((s) => s.name.toLowerCase().includes(term)) : setlists),
    [setlists, term],
  )
  const filteredSongs = useMemo(
    () =>
      term
        ? songs.filter(
            (s) => s.title.toLowerCase().includes(term) || s.artist?.toLowerCase().includes(term),
          )
        : songs,
    [songs, term],
  )

  function createSetlist() {
    const name = window.prompt('Name der neuen Setlist?')
    if (!name?.trim()) return
    const setlist: Setlist = {
      id: randomId(),
      name: name.trim(),
      entries: songs.map((song) => ({ id: randomId(), songId: song.id, variantId: null })),
    }
    saveSetlist(setlist)
    setSelection({ type: 'setlist', id: setlist.id })
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
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)_2fr] gap-3 sb-app-bg p-3 text-ink">
      <div className="flex flex-col gap-4 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Songs & Setlists durchsuchen…"
          className="rounded-sb-sm bg-control px-3 py-2 text-sm text-ink"
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Setlists</h2>
            <button
              type="button"
              onClick={createSetlist}
              className="rounded-sb-sm bg-control-strong px-2 py-1 text-xs hover:bg-control-strong-hover"
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
                  className={`w-full rounded-sb-sm px-3 py-2 text-left text-sm ${
                    selection?.type === 'setlist' && selection.id === setlist.id
                      ? 'bg-accent text-accent-ink'
                      : 'bg-control hover:bg-control-hover'
                  }`}
                >
                  {setlist.name}{' '}
                  <span className={selection?.type === 'setlist' && selection.id === setlist.id ? '' : 'text-ink-faint'}>
                    ({setlist.entries.length})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">Songs</h2>
          <ul className="flex flex-col gap-1">
            {filteredSongs.map((song) => (
              <li key={song.id}>
                <button
                  type="button"
                  onClick={() => setSelection({ type: 'song', songId: song.id, variantId: null })}
                  className="w-full truncate rounded-sb-sm bg-control px-3 py-2 text-left text-sm hover:bg-control-hover"
                >
                  {song.title || '(ohne Titel)'}
                  {song.artist && <span className="text-ink-faint"> — {song.artist}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb">
        {selection?.type === 'setlist' ? (
          <SetlistDetail
            setlistId={selection.id}
            onSelectSong={(songId, variantId) => setSelection({ type: 'song', songId, variantId })}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-faint">
            Wähle links eine Setlist oder einen Song aus.
          </div>
        )}
      </div>
    </div>
  )
}

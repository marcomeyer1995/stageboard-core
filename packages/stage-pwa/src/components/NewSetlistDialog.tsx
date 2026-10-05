import { useState } from 'react'
import type { Song } from 'shared-types'
import { useBackHandler } from '../lib/backNavigation'

interface NewSetlistDialogProps {
  /** In the order the library shows them - picked songs keep this order. */
  songs: Song[]
  onCancel: () => void
  onDone: (name: string, songIds: string[]) => void
}

/**
 * "Neue Setlist" (#183): the name plus an optional checklist of existing songs in one dialog -
 * not a wizard, since picking songs gates nothing. "Fertig" with nothing ticked creates an empty
 * setlist exactly like before. Opens at the top of the screen so the keyboard can't cover it
 * (same reason as DialogHost's typing dialogs).
 */
export function NewSetlistDialog({ songs, onCancel, onDone }: NewSetlistDialogProps) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useBackHandler(onCancel)

  function toggle(songId: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }

  function finish() {
    if (!name.trim()) return
    onDone(
      name.trim(),
      songs.filter((song) => picked.has(song.id)).map((song) => song.id),
    )
  }

  return (
    <div
      role="dialog"
      aria-label="Neue Setlist"
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-6"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          finish()
        }}
        className="flex max-h-[min(90vh,90dvh)] w-full max-w-md flex-col gap-4 rounded-sb border border-line bg-surface p-5 text-ink"
      >
        {/* Buttons beside the title, not under the song list: with the on-screen keyboard open
            (landscape tablet) anything below the list sits behind it. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Neue Setlist</h2>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="min-h-12 rounded-sb bg-control px-4 font-semibold text-ink-soft hover:bg-control-hover">
              Abbrechen
            </button>
            <button type="submit" disabled={!name.trim()} className="min-h-12 rounded-sb bg-accent px-5 font-bold text-accent-ink disabled:opacity-40">
              Fertig
            </button>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Name der neuen Setlist
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-sb-sm bg-control px-3 text-base text-ink"
          />
        </label>

        {songs.length > 0 && (
          <div className="flex min-h-0 flex-col gap-2">
            <p className="text-sm text-ink-muted">
              Songs gleich mit hinzufügen (optional){picked.size > 0 ? ` - ${picked.size} ausgewählt` : ''}
            </p>
            <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto" aria-label="Songs">
              {songs.map((song) => (
                <li key={song.id}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-sb-sm bg-control px-3 hover:bg-control-hover">
                    <input type="checkbox" checked={picked.has(song.id)} onChange={() => toggle(song.id)} className="h-6 w-6 flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-base">
                      {song.title || '(ohne Titel)'}
                      {song.artist && <span className="text-ink-faint"> — {song.artist}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

      </form>
    </div>
  )
}

import { useState } from 'react'
import type { Song } from 'shared-types'
import { Button, CheckRow, Dialog, Field } from './ui'

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

  // The shared dialog (docs/15 D6): "Abbrechen" + "Anlegen" in the fixed bottom row. The page
  // shrinks with the on-screen keyboard (index.html: interactive-widget=resizes-content), so the
  // row stays above it - the reason these buttons used to sit beside the title.
  return (
    <Dialog
      title="Neue Setlist"
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Abbrechen</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={finish}>
            Anlegen
          </Button>
        </>
      }
    >
      <form
        
        onSubmit={(e) => {
          e.preventDefault()
          finish()
        }}
        className="flex min-h-0 flex-col gap-4"
      >
        <Field label="Name der neuen Setlist" autoFocus value={name} onChange={(e) => setName(e.target.value)} />

        {songs.length > 0 && (
          <SongPicker songs={songs} picked={picked} onToggle={toggle} />
        )}
      </form>
    </Dialog>
  )
}

/** Optional songs to start with - pick several, as rows with the chips' checkbox (docs/15 D7). */
function SongPicker({ songs, picked, onToggle }: { songs: Song[]; picked: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-ink-soft">
        Songs gleich mit hinzufügen (optional){picked.size > 0 ? ` - ${picked.size} ausgewählt` : ''}
      </p>
      <ul className="flex flex-col gap-1" aria-label="Songs">
        {songs.map((song) => {
          const on = picked.has(song.id)
          return (
            <li key={song.id}>
              <CheckRow checked={on} onToggle={() => onToggle(song.id)}>
                {song.title || '(ohne Titel)'}
                {song.artist && <span className="text-ink-faint"> — {song.artist}</span>}
              </CheckRow>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

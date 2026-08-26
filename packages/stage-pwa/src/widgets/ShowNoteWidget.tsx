import { useState } from 'react'
import type { ShowLogEvent } from 'shared-types'
import { useActiveProfile } from '../lib/useActiveProfile'
import { latestShowId, useShowLogStore } from '../store/useShowLogStore'
import { useProfilesStore } from '../store/useProfilesStore'

/**
 * Live in-show notes from anyone - musicians or crew - not gated to the Master-Token
 * holder the way song/show tracking is (see useShowLogTracker.ts). A crew member spots
 * something ("guitar's too loud for this song") and logs it here to check after the
 * show, per the Post-Gig Report discussion.
 */
export function ShowNoteWidget() {
  const events = useShowLogStore((state) => state.events)
  const addNote = useShowLogStore((state) => state.addNote)
  const activeProfile = useActiveProfile()
  const profiles = useProfilesStore((state) => state.profiles)
  const [text, setText] = useState('')

  const showId = latestShowId(events)
  const notes = events
    .filter((event): event is Extract<ShowLogEvent, { type: 'note' }> => event.type === 'note')
    .filter((note) => note.showId === showId)
    .slice()
    .reverse()

  function authorName(authorProfileId: string | null): string {
    if (!authorProfileId) return 'Unbekannt'
    return profiles.find((profile) => profile.id === authorProfileId)?.name ?? 'Unbekannt'
  }

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    void addNote(trimmed, activeProfile?.id ?? null)
    setText('')
  }

  return (
    <div className="flex h-full flex-col gap-2 text-sm text-ink-soft">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {!showId && <p className="text-ink-faint">Noch keine Show aktiv.</p>}
        {showId && notes.length === 0 && <p className="text-ink-faint">Noch keine Notizen.</p>}
        {notes.map((note) => (
          <div key={note.id} className="rounded-sb-sm bg-control px-2 py-1">
            <p className="text-ink">{note.text}</p>
            <p className="text-[10px] text-ink-faint">{authorName(note.authorProfileId)}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Notiz hinzufügen…"
          disabled={!showId}
          className="min-w-0 flex-1 rounded-sb-sm bg-control px-2 py-1 text-ink disabled:opacity-40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!showId}
          className="flex-shrink-0 rounded-sb-sm bg-control-strong px-2 py-1 text-xs text-ink hover:bg-control-strong-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hinzufügen
        </button>
      </div>
    </div>
  )
}

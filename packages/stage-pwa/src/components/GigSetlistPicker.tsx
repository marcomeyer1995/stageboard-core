import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { SetlistPickRow } from './SetlistPickRow'

/**
 * The Gig's active setlist in the ☰ drawer (Marco, 2026-10-16): the master picks it there - no
 * trip to the Bibliothek; everyone else reads it. Locked while a song plays, like switching to Solo
 * Üben: the whole band's queue would change mid-song.
 */
export function GigSetlistPicker() {
  const { isMaster, activeSetlist } = useQueue()
  const setlists = useSetlistsStore((state) => state.setlists)
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  return (
    <SetlistPickRow
      setlists={setlists}
      activeId={activeSetlist?.id ?? null}
      noneLabel="Keine Setlist"
      onPick={(id) => void setActiveSetlist(id)}
      readOnly={!isMaster}
      locked={playing}
      lockedHint="Während ein Song läuft, bleibt die Setlist."
    />
  )
}

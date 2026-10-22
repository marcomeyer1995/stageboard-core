import { useQueue } from '../lib/queue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { SetlistPickRow } from './SetlistPickRow'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('menu')
  return (
    <SetlistPickRow
      setlists={setlists}
      activeId={activeSetlist?.id ?? null}
      noneLabel={t('setlist.noneGig')}
      onPick={(id) => void setActiveSetlist(id)}
      readOnly={!isMaster}
      locked={playing}
      lockedHint={t('setlist.locked')}
    />
  )
}

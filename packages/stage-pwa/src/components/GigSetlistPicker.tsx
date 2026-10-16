import { useQueue } from '../lib/queue'
import { useDialogStore } from '../store/useDialogStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { Select } from './ui'

/**
 * The master picks the Gig's active setlist right from the ☰ drawer (Marco, 2026-10-16) - no trip
 * to the Bibliothek. Only for the master, like "Aktivieren" there; while the show plays it asks
 * first, since the whole band's queue changes.
 */
export function GigSetlistPicker() {
  const { isMaster, activeSetlist } = useQueue()
  const setlists = useSetlistsStore((state) => state.setlists)
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  const setActiveSetlist = useShowStateStore((state) => state.setActiveSetlist)
  const confirm = useDialogStore((state) => state.confirm)
  if (!isMaster) return null
  // Newest gig first, undated ones by name after them - like the Bibliothek's default.
  const sorted = [...setlists].sort((a, b) => (b.performanceDate ?? '').localeCompare(a.performanceDate ?? '') || a.name.localeCompare(b.name))

  return (
    <Select
      label="Aktive Setlist"
      size="stage"
      value={activeSetlist?.id ?? ''}
      onChange={async (event) => {
        const next = event.target.value || null
        if (playing && !(await confirm('Die Show läuft - die Setlist für die ganze Band wechseln?', { title: 'Setlist', confirmLabel: 'Wechseln' }))) return
        await setActiveSetlist(next)
      }}
      options={[{ value: '', label: 'Keine Setlist' }, ...sorted.map((setlist) => ({ value: setlist.id, label: setlist.name }))]}
    />
  )
}

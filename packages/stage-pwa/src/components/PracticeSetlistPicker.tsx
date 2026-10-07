import { Select } from './ui'
import { practiceSetActiveSetlist, usePracticeQueue } from '../lib/practiceQueue'
import { useSetlistsStore } from '../store/useSetlistsStore'

/** Which setlist Solo Üben works through (#234) - purely local, never the Gig show's setlist. */
export function PracticeSetlistPicker() {
  const setlists = useSetlistsStore((state) => state.setlists)
  const { activeSetlist } = usePracticeQueue()

  return (
    <Select
      label="Setlist zum Üben"
      size="stage"
      value={activeSetlist?.id ?? ''}
      onChange={(event) => practiceSetActiveSetlist(event.target.value || null)}
      options={[{ value: '', label: 'Keine Setlist (ganzer Katalog)' }, ...setlists.map((setlist) => ({ value: setlist.id, label: setlist.name }))]}
    />
  )
}

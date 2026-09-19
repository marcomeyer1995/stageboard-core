import { practiceSetActiveSetlist, usePracticeQueue } from '../lib/practiceQueue'
import { useSetlistsStore } from '../store/useSetlistsStore'

/** Which setlist Solo Üben works through (#234) - purely local, never the Gig show's setlist. */
export function PracticeSetlistPicker() {
  const setlists = useSetlistsStore((state) => state.setlists)
  const { activeSetlist } = usePracticeQueue()

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-faint">
      Setlist zum Üben
      <select
        value={activeSetlist?.id ?? ''}
        onChange={(event) => practiceSetActiveSetlist(event.target.value || null)}
        className="h-11 rounded-sb bg-control px-3 text-sm text-ink-soft"
      >
        <option value="">Keine Setlist (ganzer Katalog)</option>
        {setlists.map((setlist) => (
          <option key={setlist.id} value={setlist.id}>
            {setlist.name}
          </option>
        ))}
      </select>
    </label>
  )
}

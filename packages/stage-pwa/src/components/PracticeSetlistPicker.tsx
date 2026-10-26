import { practiceSetActiveSetlist, usePracticeQueue } from '../lib/practiceQueue'
import { SetlistPickRow } from './SetlistPickRow'
import { useVisibleSetlists } from '../lib/visibleCatalog'

/** Which setlist Solo Üben works through (#234) - purely local, never the Gig show's setlist. The
 * same row and pick list as in Gig (Marco, 2026-10-16), not a dropdown. */
export function PracticeSetlistPicker() {
  const setlists = useVisibleSetlists()
  const { activeSetlist } = usePracticeQueue()
  return <SetlistPickRow setlists={setlists} activeId={activeSetlist?.id ?? null} noneLabel="Keine Setlist (ganzer Katalog)" onPick={practiceSetActiveSetlist} />
}

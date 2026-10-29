import { practiceSetActiveSetlist, usePracticeQueue } from '../lib/practiceQueue'
import { SetlistPickRow } from './SetlistPickRow'
import { useTranslation } from 'react-i18next'
import { useVisibleSetlists } from '../lib/visibleCatalog'

/** Which setlist Solo Üben works through (#234) - purely local, never the Gig show's setlist. The
 * same row and pick list as in Gig (Marco, 2026-10-16), not a dropdown. */
export function PracticeSetlistPicker() {
  const setlists = useVisibleSetlists()
  const { activeSetlist } = usePracticeQueue()
  const { t } = useTranslation('menu')
  return <SetlistPickRow setlists={setlists} activeId={activeSetlist?.id ?? null} noneLabel={t('setlist.nonePractice')} onPick={practiceSetActiveSetlist} />
}

import type { Setlist } from 'shared-types'
import { PickRow } from './PickRow'
import { useTranslation } from 'react-i18next'

/** Newest gig first, undated ones by name after them - like the Bibliothek's default. */
function sortSetlists(setlists: readonly Setlist[]): Setlist[] {
  return [...setlists].sort((a, b) => (b.performanceDate ?? '').localeCompare(a.performanceDate ?? '') || a.name.localeCompare(b.name))
}

/** The setlist row in the ☰ drawer - Gig (the band's active setlist) and Solo Üben (this device's
 * own) alike (Marco, 2026-10-16). */
export function SetlistPickRow({
  setlists,
  activeId,
  noneLabel,
  onPick,
  readOnly,
  locked,
  lockedHint,
}: {
  setlists: readonly Setlist[]
  activeId: string | null
  /** The "no setlist" choice, e.g. "Keine Setlist (ganzer Katalog)". */
  noneLabel: string
  onPick: (setlistId: string | null) => void
  readOnly?: boolean
  locked?: boolean
  lockedHint?: string
}) {
  const { t } = useTranslation('menu')
  return (
    <PickRow
      title={t('setlist.title')}
      items={[{ id: null, name: noneLabel }, ...sortSetlists(setlists)]}
      activeId={setlists.some((setlist) => setlist.id === activeId) ? activeId : null}
      onPick={onPick}
      readOnly={readOnly}
      locked={locked}
      lockedHint={lockedHint}
    />
  )
}

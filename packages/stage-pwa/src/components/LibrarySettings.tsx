import { DEFAULT_REHEARSAL_WINDOW, type RehearsalWindow } from 'shared-types'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { PRACTICE_WINDOW_DAYS, useLibraryPrefsStore } from '../store/useLibraryPrefsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Segmented } from './ui'

const REHEARSAL_DAYS = [30, 90, 180, 365] as const
const REHEARSAL_SHOWS = [5, 10, 20] as const

/** Bibliothek "Geübt": how far back this device counts the own Solo-Üben takes. */
export function PracticeWindowSettings() {
  const days = useLibraryPrefsStore((state) => state.practiceDays)
  const setDays = useLibraryPrefsStore((state) => state.setPracticeDays)
  return (
    <Segmented
      label="Geübt zählt die letzten"
      showLabel
      hint="Sortierung „Geübt“ in der Bibliothek: wie oft du einen Song in Solo Üben gespielt hast."
      value={String(days)}
      onChange={(value) => setDays(Number(value))}
      options={PRACTICE_WINDOW_DAYS.map((d) => ({ value: String(d), label: `${d} Tage` }))}
    />
  )
}

/** Bibliothek "Geprobt": what counts as "recently played together" - for the whole band, admins only. */
export function RehearsalWindowSettings() {
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const window = settings.rehearsalWindow ?? DEFAULT_REHEARSAL_WINDOW
  const set = (next: RehearsalWindow) => void save({ ...settings, rehearsalWindow: next })
  const disabled = !isAdmin
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Geprobt zählt nach"
        showLabel
        hint={
          isAdmin
            ? 'Sortierung „Geprobt“: wie oft die Band einen Song im Gig-Modus gespielt hat - Proben und Auftritte.'
            : 'Nur Band-Admins können das ändern.'
        }
        value={window.kind}
        onChange={(kind) => set(kind === 'days' ? { kind: 'days', days: 90 } : { kind: 'shows', shows: 5 })}
        options={[
          { value: 'days', label: 'Tagen', disabled },
          { value: 'shows', label: 'Shows', disabled },
        ]}
      />
      {window.kind === 'days' ? (
        <Segmented
          label="Zeitraum"
          value={String(window.days)}
          onChange={(value) => set({ kind: 'days', days: Number(value) })}
          options={REHEARSAL_DAYS.map((d) => ({ value: String(d), label: `${d} Tage`, disabled }))}
        />
      ) : (
        <Segmented
          label="Anzahl Shows"
          value={String(window.shows)}
          onChange={(value) => set({ kind: 'shows', shows: Number(value) })}
          options={REHEARSAL_SHOWS.map((n) => ({ value: String(n), label: `letzte ${n}`, disabled }))}
        />
      )}
    </div>
  )
}

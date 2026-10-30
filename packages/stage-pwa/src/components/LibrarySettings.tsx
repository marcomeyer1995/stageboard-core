import { DEFAULT_REHEARSAL_WINDOW, type RehearsalWindow } from 'shared-types'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { PRACTICE_WINDOW_DAYS, useLibraryPrefsStore } from '../store/useLibraryPrefsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Segmented } from './ui'
import { useTranslation } from 'react-i18next'

const REHEARSAL_DAYS = [30, 90, 180, 365] as const
const REHEARSAL_SHOWS = [5, 10, 20] as const

/** Bibliothek "Geübt": how far back this device counts the own Solo-Üben takes. */
export function PracticeWindowSettings() {
  const { t } = useTranslation('library')
  const days = useLibraryPrefsStore((state) => state.practiceDays)
  const setDays = useLibraryPrefsStore((state) => state.setPracticeDays)
  return (
    <Segmented
      label={t('win.practiced')}
      showLabel
      info={t('win.practicedInfo')}
      value={String(days)}
      onChange={(value) => setDays(Number(value))}
      options={PRACTICE_WINDOW_DAYS.map((d) => ({ value: String(d), label: t('win.days', { count: d }) }))}
    />
  )
}

/** Bibliothek "Geprobt": what counts as "recently played together" - for the whole band, admins only. */
export function RehearsalWindowSettings() {
  const { t } = useTranslation('library')
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const window = settings.rehearsalWindow ?? DEFAULT_REHEARSAL_WINDOW
  const set = (next: RehearsalWindow) => void save({ ...settings, rehearsalWindow: next })
  const disabled = !isAdmin
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label={t('win.rehearsed')}
        showLabel
        info={t('win.rehearsedInfo')}
        hint={isAdmin ? undefined : t('win.adminOnly')}
        value={window.kind}
        onChange={(kind) => set(kind === 'days' ? { kind: 'days', days: 90 } : { kind: 'shows', shows: 5 })}
        options={[
          { value: 'days', label: t('win.byDays'), disabled },
          { value: 'shows', label: t('win.byShows'), disabled },
        ]}
      />
      {window.kind === 'days' ? (
        <Segmented
          label={t('win.period')}
          value={String(window.days)}
          onChange={(value) => set({ kind: 'days', days: Number(value) })}
          options={REHEARSAL_DAYS.map((d) => ({ value: String(d), label: t('win.days', { count: d }), disabled }))}
        />
      ) : (
        <Segmented
          label={t('win.showCount')}
          value={String(window.shows)}
          onChange={(value) => set({ kind: 'shows', shows: Number(value) })}
          options={REHEARSAL_SHOWS.map((n) => ({ value: String(n), label: t('win.lastN', { count: n }), disabled }))}
        />
      )}
    </div>
  )
}

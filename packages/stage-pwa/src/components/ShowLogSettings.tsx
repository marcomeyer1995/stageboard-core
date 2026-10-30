import { SHOW_LOG_CATEGORIES, type ShowLogCategory } from 'shared-types'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { InfoHint, Switch } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * System → Band: what the band records for its Nachbericht (#673, Marco 2026-10-30) - one switch
 * per category, all on until an admin switches one off. Band settings are admin-only (server rule).
 */
export function ShowLogSettings() {
  const { t } = useTranslation('shows')
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const off = settings.showLogOff ?? []
  const toggle = (category: ShowLogCategory, on: boolean) =>
    void save({ ...settings, showLogOff: on ? off.filter((other) => other !== category) : [...off.filter((other) => other !== category), category] })

  return (
    <section aria-label={t('record.title')} className="space-y-2">
      <div className="flex items-center gap-1">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">{t('record.title')}</h2>
        <InfoHint label={t('record.explainLabel')} text={t('record.explain')} />
      </div>
      {!isAdmin && <p className="text-sm text-ink-faint">{t('record.adminOnly')}</p>}
      <div className="flex flex-col gap-1">
        {SHOW_LOG_CATEGORIES.map((category) => (
          <Switch
            key={category}
            label={t(`cat.${category}`)}
            description={t(`catHint.${category}`)}
            checked={!off.includes(category)}
            disabled={!isAdmin}
            onChange={(on) => toggle(category, on)}
          />
        ))}
      </div>
    </section>
  )
}

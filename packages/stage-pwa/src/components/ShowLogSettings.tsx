import { SHOW_LOG_CATEGORIES, type ShowLogCategory } from 'shared-types'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useState } from 'react'
import { Dialog, InfoHint, SummaryRow, Switch } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * System → Band: what the band records for its Nachbericht (#673, Marco 2026-10-30) - one switch
 * per category, all on until an admin switches one off. Band settings are admin-only (server rule).
 * On the Band page one row with how many are on; the switches in a dialog (#862) - the list grows
 * with add-ons.
 */
export function ShowLogSettings() {
  const { t } = useTranslation('shows')
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const off = settings.showLogOff ?? []
  const [open, setOpen] = useState(false)
  const on = SHOW_LOG_CATEGORIES.filter((category) => !off.includes(category)).length
  const summary = on === SHOW_LOG_CATEGORIES.length ? t('record.all') : t('record.someOn', { on, total: SHOW_LOG_CATEGORIES.length })
  const toggle = (category: ShowLogCategory, on: boolean) =>
    void save({ ...settings, showLogOff: on ? off.filter((other) => other !== category) : [...off.filter((other) => other !== category), category] })

  return (
    <section aria-label={t('record.title')} className="space-y-2">
      <div className="flex items-center gap-1">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink-faint">{t('record.title')}</h2>
        <InfoHint label={t('record.explainLabel')} text={t('record.explain')} />
      </div>
      {!isAdmin && <p className="text-sm text-ink-faint">{t('record.adminOnly')}</p>}
      <SummaryRow label={t('record.title')} summary={summary} onOpen={() => setOpen(true)} />
      {open && (
        <Dialog title={t('record.title')} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-1">
            {SHOW_LOG_CATEGORIES.map((category) => (
              <Switch
                key={category}
                label={t(`cat.${category}`)}
                description={t(`catHint.${category}`)}
                checked={!off.includes(category)}
                disabled={!isAdmin}
                onChange={(next) => toggle(category, next)}
              />
            ))}
          </div>
        </Dialog>
      )}
    </section>
  )
}

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_PLAY_LEAD_MS, PLAY_LEAD_LIMITS } from 'shared-types'
import { leadReports, suggestedLead } from '../lib/playLead'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useDeviceInfoStore } from '../store/useDeviceInfoStore'
import { useDevicesStore } from '../store/useDevicesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { InfoHint, Stepper } from './ui'

/**
 * System → Bühne: the Play lead (Marco, 2026-11-06) - how far after Play a fresh song's first
 * sound lies, the same for the whole band (admin). Each device measures at every Play how much it
 * needed (lib/leadCheck.ts) and reports it; one that needed more than the setting is named here
 * with the value to set.
 */
export function PlayLeadSettings() {
  const { t } = useTranslation('hardware')
  const settings = useBandSettingsStore((state) => state.settings)
  const save = useBandSettingsStore((state) => state.save)
  const isAdmin = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.isAdmin ?? false)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const info = useDeviceInfoStore((state) => state.deviceInfo)
  const devices = useDevicesStore((state) => state.devices)
  const lead = settings.playLeadMs ?? DEFAULT_PLAY_LEAD_MS

  // The devices' reports, only while this is on screen (like the Geräte tab).
  useEffect(() => {
    if (!activeWorkspaceId) return
    void useDeviceInfoStore.getState().init(activeWorkspaceId)
    return () => useDeviceInfoStore.getState().stop()
  }, [activeWorkspaceId])

  const reports = leadReports(info, devices)
  const tooShort = reports.filter((report) => report.neededMs > lead)
  const most = reports[0]

  return (
    <section aria-label={t('lead.title')} className="flex flex-col gap-2 rounded-container border border-line bg-surface p-4">
      <div className="flex items-center gap-1">
        <h2 className="text-lg font-bold text-ink">{t('lead.title')}</h2>
        <InfoHint label={t('lead.explainLabel')} text={t('lead.explain')} />
      </div>
      {isAdmin ? (
        <Stepper
          label={t('lead.label')}
          value={lead}
          unit="ms"
          min={PLAY_LEAD_LIMITS.min}
          max={PLAY_LEAD_LIMITS.max}
          step={PLAY_LEAD_LIMITS.step}
          onChange={(ms) => void save({ ...settings, playLeadMs: ms })}
        />
      ) : (
        <p className="text-base text-ink">{t('lead.value', { ms: lead })}</p>
      )}
      {tooShort.length > 0 ? (
        <ul role="status" className="flex flex-col gap-1 text-base text-warn">
          {tooShort.map((report) => (
            <li key={report.id}>{t('lead.tooShort', { name: report.name, ms: report.neededMs, suggest: suggestedLead(report.neededMs) })}</li>
          ))}
        </ul>
      ) : most ? (
        <p role="status" className="text-base text-ink-muted">
          {t('lead.enough', { name: most.name, ms: most.neededMs })}
        </p>
      ) : (
        <p role="status" className="text-base text-ink-faint">
          {t('lead.notMeasured')}
        </p>
      )}
    </section>
  )
}

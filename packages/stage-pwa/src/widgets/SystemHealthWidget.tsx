import i18n from '../i18n'
import { useTranslation } from 'react-i18next'
import { useShowPart } from '../lib/widgetParts'
import type { CapabilityStatus } from '../lib/capabilities'
import { useCapabilities } from '../lib/useCapabilities'
import { useContentFontSize } from '../lib/useContentFontSize'
import { useNow } from '../lib/useNow'
import { useClockSyncStore } from '../store/useClockSyncStore'
import type { ContentFontSizeConfig } from './contentFontSizeConfig'

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  get available() {
    return i18n.t('widgets:health.available')
  },
  get degraded() {
    return i18n.t('widgets:health.degraded')
  },
  get missing() {
    return i18n.t('widgets:health.missing')
  },
}

const STATUS_DOT: Record<CapabilityStatus, string> = {
  available: 'bg-ok',
  degraded: 'bg-warn',
  missing: 'bg-control-strong-hover',
}

/** Above this spread between the last few synced offsets (useClockSyncStore's `driftMs`),
 * flag amber - the offset is genuinely moving, not just one noisy burst. Picked from real
 * device data (#31 follow-up, live on home WiFi): a stable sync's offset moved 1-8ms between
 * consecutive bursts even while that burst's own RTT spread swung into the hundreds of ms, so
 * 15ms is clearly above normal per-sync noise without being so tight it flags on nothing. Not
 * derived from a spec - docs/00 §4 targets sub-5ms *execution*, not a hard bound on sync
 * drift itself (the ahead-of-time dispatch buffer is what actually protects execution). */
const DRIFT_WARN_THRESHOLD_MS = 15

/**
 * The "Cockpit-Dashboard" traffic-light overview from docs/08 Use Case 3.1 - every
 * capability the band's installed plugins provide, at a glance, plus this tablet's own
 * NTP-style clock sync to the Stage-Server (#31, docs/00 §4) - not a plugin capability, but
 * the same kind of "can I trust this system status" question. Crew/tech-facing (see
 * relevantRoles in registry.tsx), used during setup/soundcheck, not something a
 * performing musician needs cluttering their own Station.
 */
export function SystemHealthWidget({ config }: { config: ContentFontSizeConfig }) {
  const { t } = useTranslation('widgets')
  // Parts left out under "Anzeigen" in the ⋯ menu (Marco, 2026-10-17: declutter every widget).
  const showPlugins = useShowPart('plugins')
  const showSync = useShowPart('sync')
  const capabilities = useCapabilities()
  const entries = [...capabilities.entries()]
  const { offsetMs, driftMs, lastSyncedAt } = useClockSyncStore()
  const now = useNow()
  const fontSize = useContentFontSize(config)

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto text-ink-soft" style={{ fontSize }}>
      {showPlugins && <p className="text-xs font-bold uppercase tracking-widest text-ink-faint">{t('health.caption')}</p>}
      {showPlugins && entries.length === 0 && <p className="text-ink-faint">{t('health.none')}</p>}
      {showPlugins && entries.map(([capability, status]) => (
        <div
          key={capability}
          className="flex items-center justify-between gap-2 rounded-control bg-control px-2 py-1"
        >
          <span className="text-ink">{capability}</span>
          <span className="flex items-center gap-[0.4em]">
            <span
              className={`inline-block rounded-full ${STATUS_DOT[status]}`}
              style={{ width: '0.5em', height: '0.5em' }}
            />
            {STATUS_LABEL[status]}
          </span>
        </div>
      ))}

      {showSync && (
      <>
      <p className="mt-2 text-xs font-bold uppercase tracking-widest text-ink-faint">{t('health.clock')}</p>
      <div className="flex items-center justify-between gap-2 rounded-control bg-control px-2 py-1">
        <span className="text-ink">{t('health.server')}</span>
        {lastSyncedAt === null ? (
          <span className="flex items-center gap-[0.4em]">
            <span className="inline-block rounded-full bg-control-strong-hover" style={{ width: '0.5em', height: '0.5em' }} />
            {t('health.notYet')}
          </span>
        ) : (
          <span className="flex items-center gap-[0.4em]">
            <span
              className={`inline-block rounded-full ${
                driftMs !== null && driftMs > DRIFT_WARN_THRESHOLD_MS ? 'bg-warn' : 'bg-ok'
              }`}
              style={{ width: '0.5em', height: '0.5em' }}
            />
            {t('health.detail', { offset: `${offsetMs >= 0 ? '+' : ''}${Math.round(offsetMs)}`, drift: driftMs === null ? '?' : Math.round(driftMs), s: Math.max(0, Math.round((now - lastSyncedAt) / 1000)) })}
          </span>
        )}
      </div>
      </>
      )}
    </div>
  )
}

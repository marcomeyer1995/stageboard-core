import i18n from '../i18n'
import { useTranslation } from 'react-i18next'
import { useShowPart } from '../lib/widgetParts'
import { Select } from '../components/ui'
import { CAPABILITIES, type CapabilityId } from 'shared-types'
import { pluginProviding, pluginStatus, type CapabilityStatus } from '../lib/capabilities'
import { useMidiTrigger } from '../lib/useMidiTrigger'
import { useNow } from '../lib/useNow'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type DeviceStatusConfig } from './deviceStatusConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  get available() {
    return i18n.t('widgets:dev.available')
  },
  get degraded() {
    return i18n.t('widgets:dev.degraded')
  },
  get missing() {
    return i18n.t('widgets:dev.missing')
  },
}

const STATUS_DOT: Record<CapabilityStatus, string> = {
  available: 'bg-ok',
  degraded: 'bg-control-strong-hover',
  missing: 'bg-control-strong-hover',
}

/**
 * A glanceable status for exactly one Logical Device (#23) - unlike BackupStatusWidget's
 * capability-wide status, this resolves the device's own bound plugin (falling back to
 * `pluginProviding` the same way cueFiring.ts does), so two devices sharing a capability
 * (#149) each show their own real state instead of one blended answer.
 */
export function DeviceStatusWidget({ config }: { config: DeviceStatusConfig }) {
  const { t } = useTranslation('widgets')
  // Parts left out under "Anzeigen" in the ⋯ menu (Marco, 2026-10-17: declutter every widget).
  const showName = useShowPart('name')
  const devices = useLogicalDevicesStore((s) => s.devices)
  const installed = usePluginsStore((s) => s.installed)
  const health = usePluginsStore((s) => s.health)
  const { status: midiStatus } = useMidiTrigger()
  const now = useNow()

  const device = devices.find((d) => d.id === config.logicalDeviceId) ?? null

  // Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14).
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  if (!device) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
          {t('dev.caption')}
        </span>
        <span className="text-ink-faint">{t('dev.none')}</span>
      </div>
    )
  }

  const clientProbes: Record<CapabilityId, boolean> = {
    [CAPABILITIES.midiInput]: midiStatus === 'connected',
  }
  const pluginId = device.pluginId ?? pluginProviding(installed, device.capability)
  const plugin = installed.find((p) => p.id === pluginId) ?? null
  const status: CapabilityStatus = plugin
    ? pluginStatus(plugin, device.capability, health, clientProbes, now)
    : 'missing'

  return (
    <div className="flex h-full flex-col items-center gap-1 text-center">
      {showName && (
        <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
          {device.name}
        </span>
      )}
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden">
        <span style={{ fontSize }} className="flex items-center gap-[0.3em] whitespace-nowrap text-ink-soft">
          <span
            className={`inline-block rounded-full ${STATUS_DOT[status]}`}
            style={{ width: '0.6em', height: '0.6em' }}
          />
          {STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  )
}

export function DeviceStatusConfigPanel({
  config,
  onChange,
}: {
  config: DeviceStatusConfig
  onChange: (next: DeviceStatusConfig) => void
}) {
  const { t } = useTranslation('widgets')
  const devices = useLogicalDevicesStore((s) => s.devices)

  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t('dev.device')}
        value={config.logicalDeviceId ?? ''}
        onChange={(e) => onChange({ ...config, logicalDeviceId: e.target.value || undefined })}
        options={[{ value: '', label: t('dev.choose') }, ...devices.map((device) => ({ value: device.id, label: device.name }))]}
      />
      <SizeRatioSlider
        label={t('w.size')}
        ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
        onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
      />
    </div>
  )
}

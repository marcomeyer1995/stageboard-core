import { CAPABILITIES, type CapabilityId } from 'shared-types'
import { pluginProviding, pluginStatus, type CapabilityStatus } from '../lib/capabilities'
import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
import { useMidiTrigger } from '../lib/useMidiTrigger'
import { useNow } from '../lib/useNow'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import type { DeviceStatusConfig } from './deviceStatusConfig'

const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: 'Online',
  degraded: 'Nicht erreichbar',
  missing: 'Nicht verbunden',
}

const STATUS_DOT: Record<CapabilityStatus, string> = {
  available: 'bg-green-500',
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
  const devices = useLogicalDevicesStore((s) => s.devices)
  const installed = usePluginsStore((s) => s.installed)
  const health = usePluginsStore((s) => s.health)
  const { status: midiStatus } = useMidiTrigger()
  const now = useNow()

  const device = devices.find((d) => d.id === config.logicalDeviceId) ?? null

  // The status line (dot + label) auto-fits the space left over once the device-name caption
  // takes its own, fixed-size row - chosen over cq units/discrete tiers after Marco compared
  // all three live (2026-09-14, see the widget-font-autofit memory). Called unconditionally,
  // ahead of the "no device" early return.
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLDivElement, HTMLSpanElement>(
    { min: 10, max: 96 },
    [device?.id],
  )

  if (!device) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
          Geräte-Status
        </span>
        <span className="text-ink-faint">Kein Gerät ausgewählt</span>
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
      <span className="text-xs font-bold uppercase tracking-widest text-ink-faint">
        {device.name}
      </span>
      <div ref={containerRef} className="flex w-full flex-1 items-center justify-center overflow-hidden">
        <span
          ref={textRef}
          style={{ fontSize }}
          className="flex items-center gap-[0.3em] whitespace-nowrap text-ink-soft"
        >
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
  const devices = useLogicalDevicesStore((s) => s.devices)

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      Gerät
      <select
        className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
        value={config.logicalDeviceId ?? ''}
        onChange={(e) => onChange({ ...config, logicalDeviceId: e.target.value || undefined })}
      >
        <option value="">— Gerät wählen —</option>
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.name}
          </option>
        ))}
      </select>
    </label>
  )
}

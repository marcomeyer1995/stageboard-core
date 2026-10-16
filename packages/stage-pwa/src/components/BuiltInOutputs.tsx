import { CAPABILITIES, SERVER_EXECUTION_TARGET, type CapabilityId, type LogicalDevice } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { resolveHardwareBinding } from '../lib/hardwareRouting'
import { randomId } from '../lib/id'
import { useDevicesStore } from '../store/useDevicesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { Select } from './ui'

/** The two outputs every band has without a plugin (System split, Marco 2026-10-16). */
export const BUILT_IN_OUTPUTS: { capability: CapabilityId; label: string }[] = [
  { capability: CAPABILITIES.clickTrack, label: 'Klick' },
  { capability: CAPABILITIES.audioPlayback, label: 'Backing-Track' },
]

/** The role each built-in output reads - the first one with its capability, as routing does. */
export function builtInRoles(devices: LogicalDevice[]): LogicalDevice[] {
  return BUILT_IN_OUTPUTS.map((output) => resolveHardwareBinding(devices, output.capability)).filter((device): device is LogicalDevice => device !== null)
}

const MASTER = ''

/**
 * Klick and Backing-Track in Bühnentechnik: which tablet plays them in Gig. They used to need the
 * Mock Click / Mock Playback plugins as a "type" - stand-ins that play nothing, so a role pointing
 * at a tablet that wasn't there left the band without a track. Now they're built in: without a
 * chosen tablet, the device that runs the show plays them (hardwareRouting `masterFallback`).
 */
export function BuiltInOutputs() {
  const devices = useLogicalDevicesStore((state) => state.devices)
  const save = useLogicalDevicesStore((state) => state.save)
  const knownDevices = useDevicesStore((state) => state.devices)

  return (
    <section aria-label="Klick und Backing-Track" className="flex flex-col gap-3 rounded-container border border-line bg-surface p-4 shadow-sb">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-ink">Klick und Backing-Track</h2>
        <p className="text-sm text-ink-muted">Welches Gerät sie im Gig spielt. Ohne Auswahl spielt sie das Gerät, das die Show führt (Master).</p>
      </header>
      {BUILT_IN_OUTPUTS.map(({ capability, label }) => {
        const role = resolveHardwareBinding(devices, capability)
        const target = role?.executionTarget && role.executionTarget !== SERVER_EXECUTION_TARGET ? role.executionTarget : MASTER
        const tablets = knownDevices.filter((device) => !device.revoked || device.id === target)
        const options = [
          { value: MASTER, label: 'Gerät, das die Show führt' },
          ...tablets.map((device) => ({ value: device.id, label: device.id === getDeviceId() ? `${device.name} (dieses Gerät)` : device.name })),
          // A tablet no longer in the band's list stays visible, so the choice isn't silently wrong.
          ...(target !== MASTER && !tablets.some((device) => device.id === target) ? [{ value: target, label: 'unbekanntes Gerät' }] : []),
        ]
        return (
          <Select
            key={capability}
            label={label}
            value={target}
            options={options}
            onChange={(e) => {
              const executionTarget = e.target.value || null
              if (role) void save({ ...role, pluginId: null, executionTarget })
              else if (executionTarget) void save({ id: randomId(), name: label, capability, pluginId: null, executionTarget })
            }}
          />
        )
      })}
    </section>
  )
}

import i18n from '../i18n'
import { CAPABILITIES, SERVER_EXECUTION_TARGET, type CapabilityId, type LogicalDevice } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { getDeviceId } from '../lib/deviceId'
import { resolveHardwareBindings } from '../lib/hardwareRouting'
import { randomId } from '../lib/id'
import { useDevicesStore } from '../store/useDevicesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { ToggleChip } from './ui'
import { useTranslation } from 'react-i18next'

interface BuiltInOutput {
  capability: CapabilityId
  label: string
  /** What plays it when no tablet is chosen. */
  fallback: string
}

/** The outputs every band has without a device plugin (System split + review, Marco 2026-10-16).
 * Ansagen only once its add-on is installed. */
export const BUILT_IN_OUTPUTS: BuiltInOutput[] = [
  {
    capability: CAPABILITIES.clickTrack,
    get label() {
      return i18n.t('hardware:out.click')
    },
    get fallback() {
      return i18n.t('hardware:out.showDevice')
    },
  },
  {
    capability: CAPABILITIES.audioPlayback,
    get label() {
      return i18n.t('hardware:out.track')
    },
    get fallback() {
      return i18n.t('hardware:out.showDevice')
    },
  },
  {
    capability: CAPABILITIES.sectionAnnouncements,
    get label() {
      return i18n.t('hardware:out.announcements')
    },
    get fallback() {
      return i18n.t('hardware:out.likeClick')
    },
  },
]

/** The roles of the built-in outputs - one per tablet that plays it (several since 2026-11-04). */
export function builtInRoles(devices: LogicalDevice[]): LogicalDevice[] {
  return BUILT_IN_OUTPUTS.flatMap((output) => resolveHardwareBindings(devices, output.capability))
}

const tabletOf = (role: LogicalDevice) => (role.executionTarget && role.executionTarget !== SERVER_EXECUTION_TARGET ? role.executionTarget : null)

/**
 * Klick, Backing-Track and Ansagen as the fixed first entries of Bühnentechnik's device list: which
 * tablet plays them in Gig. They used to need the Mock Click / Mock Playback plugins as a "type" -
 * stand-ins that play nothing. Now they're built in: without a chosen tablet, the device that runs
 * the show plays click and track (hardwareRouting `masterFallback`), the announcements come with
 * the click (useAnnouncementDriver). Can't be removed, only pointed elsewhere.
 *
 * Several tablets per output (Marco, 2026-11-04): each musician can hear the click from their own
 * tablet. One role per ticked tablet; unticking the last keeps its role with no tablet.
 */
export function BuiltInOutputs() {
  const { t } = useTranslation('hardware')
  const devices = useLogicalDevicesStore((state) => state.devices)
  const save = useLogicalDevicesStore((state) => state.save)
  const remove = useLogicalDevicesStore((state) => state.remove)
  const knownDevices = useDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)
  const outputs = BUILT_IN_OUTPUTS.filter((output) => output.capability !== CAPABILITIES.sectionAnnouncements || pluginProviding(installed, output.capability) !== null)

  return (
    <>
      {outputs.map(({ capability, label, fallback }) => {
        const roles = resolveHardwareBindings(devices, capability)
        const targets = roles.map(tabletOf).filter((id): id is string => id !== null)
        const tablets = knownDevices.filter((device) => !device.revoked || targets.includes(device.id))
        const chips = [
          ...tablets.map((device) => ({ id: device.id, label: device.id === getDeviceId() ? t('out.thisDevice', { name: device.name }) : device.name })),
          // A tablet no longer in the band's list stays visible, so the choice isn't silently wrong.
          ...targets.filter((id) => !tablets.some((device) => device.id === id)).map((id) => ({ id, label: t('unknownDevice') })),
        ]
        function toggle(tablet: string, on: boolean) {
          if (on) {
            // A role without a tablet (unticked before, or plugin-era) is reused before adding one.
            const free = roles.find((role) => tabletOf(role) === null)
            void save(free ? { ...free, pluginId: null, executionTarget: tablet } : { id: randomId(), name: label, capability, pluginId: null, executionTarget: tablet })
            return
          }
          for (const role of roles.filter((r) => tabletOf(r) === tablet)) {
            if (roles.length > 1) void remove(role.id)
            else void save({ ...role, pluginId: null, executionTarget: null })
          }
        }
        return (
          // One list row like the gear below (docs/15 D10): name left, the playing tablets right (D7: several = chips).
          <div key={capability} aria-label={label} role="group" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line bg-surface px-3 py-1">
            <span className="w-32 flex-shrink-0 font-semibold">{label}</span>
            <div role="group" aria-label={t('builtIn.playsOn', { label })} className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-2 py-1">
              {chips.map((chip) => (
                <ToggleChip key={chip.id} label={chip.label} selected={targets.includes(chip.id)} onToggle={(on) => toggle(chip.id, on)} />
              ))}
              {targets.length === 0 && <span className="text-ink-soft">{t('builtIn.noneChosen', { fallback })}</span>}
            </div>
          </div>
        )
      })}
    </>
  )
}

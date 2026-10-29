import i18n from '../i18n'
import { CAPABILITIES, SERVER_EXECUTION_TARGET, type CapabilityId, type LogicalDevice } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { getDeviceId } from '../lib/deviceId'
import { resolveHardwareBinding } from '../lib/hardwareRouting'
import { randomId } from '../lib/id'
import { useDevicesStore } from '../store/useDevicesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { Select } from './ui'
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

/** The role each built-in output reads - the first one with its capability, as routing does. */
export function builtInRoles(devices: LogicalDevice[]): LogicalDevice[] {
  return BUILT_IN_OUTPUTS.map((output) => resolveHardwareBinding(devices, output.capability)).filter((device): device is LogicalDevice => device !== null)
}

const FALLBACK = ''

/**
 * Klick, Backing-Track and Ansagen as the fixed first entries of Bühnentechnik's device list: which
 * tablet plays them in Gig. They used to need the Mock Click / Mock Playback plugins as a "type" -
 * stand-ins that play nothing. Now they're built in: without a chosen tablet, the device that runs
 * the show plays click and track (hardwareRouting `masterFallback`), the announcements come with
 * the click (useAnnouncementDriver). Can't be removed, only pointed elsewhere.
 */
export function BuiltInOutputs() {
  const { t } = useTranslation('hardware')
  const devices = useLogicalDevicesStore((state) => state.devices)
  const save = useLogicalDevicesStore((state) => state.save)
  const knownDevices = useDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)
  const outputs = BUILT_IN_OUTPUTS.filter((output) => output.capability !== CAPABILITIES.sectionAnnouncements || pluginProviding(installed, output.capability) !== null)

  return (
    <>
      {outputs.map(({ capability, label, fallback }) => {
        const role = resolveHardwareBinding(devices, capability)
        const target = role?.executionTarget && role.executionTarget !== SERVER_EXECUTION_TARGET ? role.executionTarget : FALLBACK
        const tablets = knownDevices.filter((device) => !device.revoked || device.id === target)
        const options = [
          { value: FALLBACK, label: fallback },
          ...tablets.map((device) => ({ value: device.id, label: device.id === getDeviceId() ? t('out.thisDevice', { name: device.name }) : device.name })),
          // A tablet no longer in the band's list stays visible, so the choice isn't silently wrong.
          ...(target !== FALLBACK && !tablets.some((device) => device.id === target) ? [{ value: target, label: t('unknownDevice') }] : []),
        ]
        return (
          // One list row like the gear below (docs/15 D10): name left, the playing device right.
          <div key={capability} aria-label={label} role="group" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line bg-surface px-3 py-1">
            <label htmlFor={`output-${capability}`} className="w-32 flex-shrink-0 font-semibold">
              {label}
            </label>
            <div className="min-w-[12rem] flex-1">
              <Select
                id={`output-${capability}`}
                aria-label={t('builtIn.playsOn', { label })}
                value={target}
                options={options}
                onChange={(e) => {
                  const executionTarget = e.target.value || null
                  if (role) void save({ ...role, pluginId: null, executionTarget })
                  else if (executionTarget) void save({ id: randomId(), name: label, capability, pluginId: null, executionTarget })
                }}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}

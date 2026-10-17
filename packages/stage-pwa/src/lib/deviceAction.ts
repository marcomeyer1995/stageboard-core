import type { ShowControlEvent } from 'shared-types'
import { pluginProviding } from './capabilities'
import { capabilityTiming } from './capabilityTiming'
import { getServerTime } from './clockSync'
import { getTranslator, preloadDynamicTranslator, supportsLocalExecution } from './clientTranslator'
import { triggerDeviceControl } from './deviceControlClient'
import { resolveHardwareBindingById, resolveHardwareEngine } from './hardwareRouting'
import { triggerShowControl } from './showControlClient'
import { getStageServerUrl } from './stageServer'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Sends a device command right now - from a pedal, a MIDI controller or a widget button (docs/23):
 * on this tablet's translator when the device hangs here, through the tablet it hangs at, or
 * through its Stage-Server plugin. Any musician may (docs/23 §5a: the light technician at FOH
 * while the guitarist is master). Returns an error message, or null.
 *
 * `scheduledAt` (server time): the moment it should go out ("auf den Takt", docs/23 §4a). A
 * driver that sends at a given moment itself (a WebMIDI timestamp) or the Stage-Server's gateway
 * gets it with the command; for any other driver this waits for the moment first.
 */
export async function fireDeviceAction(targetLogicalDeviceId: string, type: string, payload: Record<string, unknown>, scheduledAt?: number): Promise<string | null> {
  const devices = useLogicalDevicesStore.getState().devices
  const installed = usePluginsStore.getState().installed
  const deviceId = useShowStateStore.getState().deviceId
  const device = resolveHardwareBindingById(devices, targetLogicalDeviceId)
  if (!device) return 'Gerät nicht gefunden'
  const pluginId = device.pluginId ?? pluginProviding(installed, device.capability)
  const engine = resolveHardwareEngine(device, deviceId, pluginId, supportsLocalExecution(installed, device.capability))
  const at = scheduledAt === undefined ? undefined : Math.max(0, Math.round(scheduledAt))
  const timed = at !== undefined && engine !== 'plugin' && !capabilityTiming(installed, device.capability, pluginId).honoursScheduledAt
  if (timed) await waitUntil(at)
  const event: ShowControlEvent = { type, payload, logicalDeviceId: device.id, ...(at !== undefined && !timed ? { scheduledAt: at } : {}) }
  if (engine === 'local-mine') {
    await preloadDynamicTranslator(device.capability, installed, getStageServerUrl() ?? null)
    const translator = getTranslator(device.capability)
    if (!translator) return 'Kein Treiber für dieses Gerät'
    await translator(event)
    return null
  }
  if (engine === 'local-other') {
    const result = await triggerDeviceControl(useWorkspaceStore.getState().activeWorkspaceId, device.executionTarget!, device.capability, event)
    return result.status === 'error' ? (result.message ?? 'Fehler') : null
  }
  if (engine === 'plugin' && pluginId) {
    const result = await triggerShowControl(pluginId, event)
    return result.status === 'error' ? (result.message ?? 'Fehler') : null
  }
  return 'Gerät nicht erreichbar'
}

function waitUntil(serverTime: number): Promise<void> {
  const delayMs = serverTime - getServerTime()
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve()
}

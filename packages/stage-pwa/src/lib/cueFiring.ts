import type { LogicalDevice, PluginInstallation, ShowCue } from 'shared-types'
import { pluginProviding } from './capabilities'
import { getTranslator, supportsLocalExecution } from './clientTranslator'
import { resolveHardwareBindingById, resolveHardwareEngine } from './hardwareRouting'
import { triggerShowControl } from './showControlClient'

export interface FireContext {
  deviceId: string
  logicalDevices: LogicalDevice[]
  installed: PluginInstallation[]
}

/**
 * Fires (or silently skips) one cue on this device - #102's cue scheduler and, later, any
 * ad-hoc-by-LogicalDeviceId trigger share this same decision. 'local-mine' calls the Translator
 * directly, 'plugin' forwards to the Stage-Server, and 'local-other'/'none' do nothing at all:
 * per docs/00 §6's "Dual Execution Contexts", the *other* device bound to this Logical Device
 * runs its own scheduler instance off the same synced clock and fires it independently - zero
 * network traffic for the predefined-timeline case, unlike ad-hoc events.
 *
 * Kept free of any store import (unlike useCueScheduler.ts) so it stays unit-testable without
 * workspaceDb.ts's top-level `new PouchDB(...)` - same reasoning hardwareRouting.ts's own doc
 * comment already gives.
 */
export async function fireCue(cue: ShowCue, ctx: FireContext): Promise<void> {
  const logicalDevice = resolveHardwareBindingById(ctx.logicalDevices, cue.targetLogicalDeviceId)
  if (!logicalDevice) return

  const pluginId = logicalDevice.pluginId ?? pluginProviding(ctx.installed, logicalDevice.capability)
  const engine = resolveHardwareEngine(
    logicalDevice,
    ctx.deviceId,
    pluginId,
    supportsLocalExecution(ctx.installed, logicalDevice.capability),
  )

  if (engine === 'local-mine') {
    await getTranslator(logicalDevice.capability)?.({ type: cue.type, payload: cue.payload })
  } else if (engine === 'plugin' && pluginId) {
    await triggerShowControl(pluginId, { type: cue.type, payload: cue.payload })
  }
}

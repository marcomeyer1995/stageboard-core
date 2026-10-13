import { CAPABILITIES, type CapabilityId, type CapabilityTiming, type LogicalDevice, type PluginInstallation, type ShowCue } from 'shared-types'
import { resolveHardwareBindingById } from './hardwareRouting'
import { PLUGIN_CATALOG } from './pluginCatalog'

/** The built-ins that need no plugin on a tablet: the click (clickEngine.ts) and the backing
 * track (Web Audio engine, docs/19) - sample-exact on the audio clock. */
const CORE_TIMING: Partial<Record<CapabilityId, CapabilityTiming>> = {
  [CAPABILITIES.clickTrack]: { capability: CAPABILITIES.clickTrack, timingClass: 'sample', honoursScheduledAt: false },
  [CAPABILITIES.audioPlayback]: { capability: CAPABILITIES.audioPlayback, timingClass: 'sample', honoursScheduledAt: false },
}

/**
 * A capability's timing declaration (docs/21 §6) - from the enabled plugin providing it (the given
 * one, when the Logical Device pins a plugin), its own manifest first, then the catalog entry of
 * the same id (manifests installed before docs/21 carry none), then the core built-ins. Anything
 * undeclared is class `none`, acting on receipt.
 */
export function capabilityTiming(installed: PluginInstallation[], capability: CapabilityId, pluginId?: string | null): CapabilityTiming {
  for (const plugin of installed) {
    if (!plugin.enabled || !plugin.capabilities.includes(capability) || (pluginId && plugin.id !== pluginId)) continue
    const declared =
      plugin.timing?.find((entry) => entry.capability === capability) ??
      PLUGIN_CATALOG.find((entry) => entry.id === plugin.id)?.timing?.find((entry) => entry.capability === capability)
    if (declared) return declared
  }
  return CORE_TIMING[capability] ?? { capability, timingClass: 'none', honoursScheduledAt: false }
}

/** How much earlier than its due moment a cue must be sent so its output really happens on time
 * (docs/21 §3) - the plugin's declared latency for now; a calibrated value per route replaces it
 * once calibration exists. 0 when unknown. */
export function cueLatencyMs(cue: ShowCue, logicalDevices: LogicalDevice[], installed: PluginInstallation[]): number {
  const device = resolveHardwareBindingById(logicalDevices, cue.targetLogicalDeviceId)
  if (!device) return 0
  return capabilityTiming(installed, device.capability, device.pluginId).defaultLatencyMs ?? 0
}

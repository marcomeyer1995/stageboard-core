import { SERVER_EXECUTION_TARGET, type HardwareBinding, type HardwareSetup, type LogicalDevice } from 'shared-types'

/**
 * Where a capability's triggers actually go, given the active HardwareSetup (#10) - replaces
 * the earlier per-capability `deviceClaims` map with the same widget-facing shape. Deliberately
 * mode-agnostic: Practice mode's "always play locally regardless of any binding" is
 * audio-specific (Practice has no lighting/mixer equivalent at all), so callers that care about
 * Practice mode override the result themselves rather than this function taking a mode param.
 */
export type HardwareRoutingEngine = 'plugin' | 'local-mine' | 'local-other' | 'none'

/**
 * The active HardwareSetup's binding for a capability, resolved via whichever Logical Device
 * declares that capability - first match wins, same tie-break `pluginProviding` (capabilities.ts)
 * already uses for plugins (true per-LogicalDeviceId targeting needs WidgetInstance/ShowCue to
 * reference one directly, which isn't wired up yet). Null whenever no setup is active, no
 * Logical Device provides this capability, or the active setup simply doesn't bind it - callers
 * treat that exactly like "nothing bound", i.e. fall back to whichever plugin provides it.
 *
 * Pure on purpose, no store reads - see useHardwareBindingFor.ts for the widget-facing hook that
 * feeds it, kept in its own module so this one stays free of workspaceDb.ts's top-level
 * `new PouchDB(...)` for unit tests (hardwareRouting.test.ts).
 */
export function resolveHardwareBinding(
  logicalDevices: LogicalDevice[],
  hardwareSetup: HardwareSetup | null,
  capability: string,
): HardwareBinding | null {
  if (!hardwareSetup) return null
  const device = logicalDevices.find((d) => d.capability === capability)
  if (!device) return null
  return hardwareSetup.bindings[device.id] ?? null
}

export function resolveHardwareEngine(
  binding: HardwareBinding | null,
  deviceId: string,
  pluginId: string | null,
): HardwareRoutingEngine {
  if (!binding || binding.executionTarget === SERVER_EXECUTION_TARGET) return pluginId ? 'plugin' : 'none'
  return binding.executionTarget === deviceId ? 'local-mine' : 'local-other'
}

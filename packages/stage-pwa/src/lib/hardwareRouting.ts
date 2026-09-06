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
 * The active HardwareSetup's binding for a specific Logical Device, by id - the correct lookup
 * for any caller that already knows exactly which one it means (#102's cue scheduler: a
 * `ShowCue.targetLogicalDeviceId` is never ambiguous, unlike a bare capability). Null whenever
 * no setup is active or the active setup simply doesn't bind this Logical Device.
 *
 * Pure on purpose, no store reads - see useHardwareBindingFor.ts for the widget-facing hook that
 * feeds resolveHardwareBinding below, kept in its own module so this one stays free of
 * workspaceDb.ts's top-level `new PouchDB(...)` for unit tests (hardwareRouting.test.ts).
 */
export function resolveHardwareBindingById(
  hardwareSetup: HardwareSetup | null,
  logicalDeviceId: string,
): HardwareBinding | null {
  if (!hardwareSetup) return null
  return hardwareSetup.bindings[logicalDeviceId] ?? null
}

/**
 * The active HardwareSetup's binding for a capability, resolved via whichever Logical Device
 * declares that capability - first match wins, same tie-break `pluginProviding` (capabilities.ts)
 * already uses for plugins. Today's four capability-routed widgets (IemWidget,
 * LightingCuesWidget, QuickActionsWidget, ShowTransportWidget) still resolve this way, since
 * none of them target a specific Logical Device yet - only #99's ShowCue does, via
 * `resolveHardwareBindingById` above. Null whenever no setup is active, no Logical Device
 * provides this capability, or the active setup simply doesn't bind it - callers treat that
 * exactly like "nothing bound", i.e. fall back to whichever plugin provides it.
 */
export function resolveHardwareBinding(
  logicalDevices: LogicalDevice[],
  hardwareSetup: HardwareSetup | null,
  capability: string,
): HardwareBinding | null {
  const device = logicalDevices.find((d) => d.capability === capability)
  if (!device) return null
  return resolveHardwareBindingById(hardwareSetup, device.id)
}

/**
 * `supportsLocalExecution` (clientTranslator.ts) gates the `local-mine`/`local-other` branch -
 * #98: a binding pointing at a tablet is only honored if something can actually execute there
 * (a real client-runtime plugin, or - audio-playback - the browser's own native playback).
 * Without it, a stale/manually-seeded binding for a capability nothing implements locally would
 * silently promise routing that never does anything.
 */
export function resolveHardwareEngine(
  binding: HardwareBinding | null,
  deviceId: string,
  pluginId: string | null,
  supportsLocalExecution: boolean,
): HardwareRoutingEngine {
  if (!binding || binding.executionTarget === SERVER_EXECUTION_TARGET) return pluginId ? 'plugin' : 'none'
  if (!supportsLocalExecution) return 'none'
  return binding.executionTarget === deviceId ? 'local-mine' : 'local-other'
}

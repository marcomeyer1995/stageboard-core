import { SERVER_EXECUTION_TARGET, type LogicalDevice } from 'shared-types'

/**
 * Where a capability's triggers actually go, given a Logical Device's own live binding
 * (`pluginId`/`executionTarget`, `logicalDevice.ts`) - replaces the earlier per-capability
 * `deviceClaims` map, and later the per-Setup `HardwareBinding` indirection, with the same
 * widget-facing shape. See `resolveExecutionEngine` below for the mode-aware entry point every
 * widget should actually call.
 */
export type HardwareRoutingEngine = 'plugin' | 'local-mine' | 'local-other' | 'none'

/**
 * The Logical Device a specific id names, if any - the correct lookup for any caller that
 * already knows exactly which one it means (#102's cue scheduler: a `ShowCue.targetLogicalDeviceId`
 * is never ambiguous, unlike a bare capability).
 *
 * Pure on purpose, no store reads - see useHardwareBindingFor.ts for the widget-facing hook that
 * feeds resolveHardwareBinding below, kept in its own module so this one stays free of
 * workspaceDb.ts's top-level `new PouchDB(...)` for unit tests (hardwareRouting.test.ts).
 */
export function resolveHardwareBindingById(logicalDevices: LogicalDevice[], logicalDeviceId: string): LogicalDevice | null {
  return logicalDevices.find((device) => device.id === logicalDeviceId) ?? null
}

/**
 * The Logical Device providing a capability, resolved via whichever one declares it - first
 * match wins, same tie-break `pluginProviding` (capabilities.ts) already uses for plugins.
 * Today's four capability-routed widgets (IemWidget, LightingCuesWidget, QuickActionsWidget,
 * ShowTransportWidget) still resolve this way, since none of them target a specific Logical
 * Device yet - only #99's ShowCue does, via `resolveHardwareBindingById` above. Null whenever no
 * Logical Device provides this capability at all - callers treat that exactly like "nothing
 * bound", i.e. fall back to whichever plugin provides it.
 */
export function resolveHardwareBinding(logicalDevices: LogicalDevice[], capability: string): LogicalDevice | null {
  return logicalDevices.find((device) => device.capability === capability) ?? null
}

/**
 * `supportsLocalExecution` (clientTranslator.ts) gates the `local-mine`/`local-other` branch -
 * #98: a binding pointing at a tablet is only honored if something can actually execute there
 * (a real client-runtime plugin, or - audio-playback - the browser's own native playback).
 * Without it, a stale/manually-seeded binding for a capability nothing implements locally would
 * silently promise routing that never does anything.
 */
export function resolveHardwareEngine(
  logicalDevice: LogicalDevice | null,
  deviceId: string,
  pluginId: string | null,
  supportsLocalExecution: boolean,
): HardwareRoutingEngine {
  const executionTarget = logicalDevice?.executionTarget ?? null
  if (!executionTarget || executionTarget === SERVER_EXECUTION_TARGET) return pluginId ? 'plugin' : 'none'
  if (!supportsLocalExecution) return 'none'
  return executionTarget === deviceId ? 'local-mine' : 'local-other'
}

/**
 * The mode-aware entry point every capability-routed widget should actually call.
 * `resolveHardwareEngine` above answers "where does Gig mode's Hardware Setup route this" - but
 * #10's whole LogicalDevice/HardwareSetup model is inherently a Gig-mode concept (multiple
 * tablets sharing one band-wide routing decision). Practice mode has exactly one tablet in play
 * and no Hardware Setup of its own at all, so if anything can execute a capability locally, it
 * should, with no configuration required to practice solo with your own gear plugged into your
 * own tablet - the same reasoning ShowTransportWidget already applied to audio-playback alone,
 * generalized here to every capability after #25's Click Generator hit the identical gap
 * (Marco, 2026-09-09). A capability with no local execution path at all
 * (`supportsLocalExecution` false - e.g. `backup`, a pure Stage-Server concept) simply has
 * nothing to route to in Practice mode either, same as any other unreachable capability (docs/07
 * Graceful Degradation) - there is no third option to fall back to.
 */
export function resolveExecutionEngine(
  mode: 'gig' | 'practice',
  logicalDevice: LogicalDevice | null,
  deviceId: string,
  pluginId: string | null,
  supportsLocalExecution: boolean,
): HardwareRoutingEngine {
  if (mode === 'practice') return supportsLocalExecution ? 'local-mine' : 'none'
  return resolveHardwareEngine(logicalDevice, deviceId, pluginId, supportsLocalExecution)
}

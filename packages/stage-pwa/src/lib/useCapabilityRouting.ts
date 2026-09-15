import { SERVER_EXECUTION_TARGET, type CapabilityId } from 'shared-types'
import { supportsLocalExecution } from './clientTranslator'
import { pluginProviding } from './capabilities'
import { resolveExecutionEngine, type HardwareRoutingEngine } from './hardwareRouting'
import { useHardwareBindingFor } from './useHardwareBindingFor'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

export interface CapabilityRouting {
  engine: HardwareRoutingEngine
  /** The plugin actually responsible for this capability's events, or null when there's
   * nothing to forward to - no plugin provides it, Practice mode never forwards, or a real
   * device binding is already directly responsible (forwarding to a plugin on top of that
   * would double-fire the same command - see the `usesDeviceOutput` check below). */
  pluginId: string | null
}

/**
 * The mode-aware binding/engine/pluginId derivation every capability-routed widget needs
 * (ShowTransportWidget's audio-playback routing, generalized) - was copy-pasted per widget
 * instead of shared, and the copies had already drifted: ClickTrackWidget.tsx's own copy (and
 * useClickOutputDriver.ts's separate one) both hard-coded `pluginId` to `null`. In
 * ClickTrackWidget.tsx this was a real, user-visible bug - a click-track Logical Device bound
 * through the Stage-Server (not a specific tablet) was unreachable, the widget always showed
 * "Kein Klick-Ausgabegerät eingerichtet" even though it was correctly configured via the
 * Hardware Setup Wizard (#148, found in #144's review). In useClickOutputDriver.ts the same
 * hardcoded `null` was actually inert (that hook only ever checks `engine === 'local-mine'`,
 * a branch `pluginId` never affects) - fixed there anyway so the two derivations can't
 * independently drift out of sync again the way they just had.
 */
export function useCapabilityRouting(capability: CapabilityId, mode: 'gig' | 'practice'): CapabilityRouting {
  const deviceId = useShowStateStore((state) => state.deviceId)
  const installed = usePluginsStore((state) => state.installed)
  const binding = useHardwareBindingFor(capability)

  const usesDeviceOutput = mode === 'gig' && binding !== null && binding.executionTarget !== SERVER_EXECUTION_TARGET
  const pluginId = mode === 'gig' && !usesDeviceOutput ? pluginProviding(installed, capability) : null
  const engine = resolveExecutionEngine(mode, binding, deviceId, pluginId, supportsLocalExecution(installed, capability))

  return { engine, pluginId }
}

import { useEffect, useMemo } from 'react'
import { API_VERSION_MISMATCH_CODE, apiVersionFits, CAPABILITIES, type CapabilityId } from 'shared-types'
import { resolveCapabilities, type CapabilityStatus } from './capabilities'
import { reportClientHealth } from './reportClientHealth'
import { useMidiTrigger } from './useMidiTrigger'
import { useServerNow } from './useNow'
import { usePluginsStore } from '../store/usePluginsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Live capability status for the dashboard. `useServerNow` is what makes a heartbeat that goes
 * stale grey the widget out on its own, without a reload.
 */
export function useCapabilities(): Map<CapabilityId, CapabilityStatus> {
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const { status: midiStatus } = useMidiTrigger()
  // Heartbeats carry the Stage-Server's time - compared in band time, not this device's clock.
  const now = useServerNow()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)

  const clientProbes = useMemo<Record<CapabilityId, boolean>>(
    () => ({ [CAPABILITIES.midiInput]: midiStatus === 'connected' }),
    [midiStatus],
  )

  // Tells the Stage-Server about this tablet's own client-hosted plugins (e.g. WebMIDI), so
  // *other* tablets learn about them too (see #49 follow-up) - this tablet's own capability
  // resolution below never waits on this, it trusts the local probe directly, unchanged.
  useEffect(() => {
    for (const plugin of installed) {
      if (!plugin.enabled || plugin.runtime !== 'client') continue
      if (!apiVersionFits(plugin)) {
        void reportClientHealth(workspaceId, plugin.id, 'error', API_VERSION_MISMATCH_CODE)
        continue
      }
      const available = plugin.capabilities.some((capability) => clientProbes[capability])
      void reportClientHealth(workspaceId, plugin.id, available ? 'online' : 'offline')
    }
  }, [installed, clientProbes, workspaceId])

  return useMemo(
    () => resolveCapabilities(installed, health, clientProbes, now),
    [installed, health, clientProbes, now],
  )
}

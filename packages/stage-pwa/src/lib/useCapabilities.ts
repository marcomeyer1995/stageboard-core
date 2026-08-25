import { useMemo } from 'react'
import { CAPABILITIES, type CapabilityId } from 'shared-types'
import { resolveCapabilities, type CapabilityStatus } from './capabilities'
import { useMidiTrigger } from './useMidiTrigger'
import { useNow } from './useNow'
import { usePluginsStore } from '../store/usePluginsStore'

/**
 * Live capability status for the dashboard. `useNow` is what makes a heartbeat that goes
 * stale grey the widget out on its own, without a reload.
 */
export function useCapabilities(): Map<CapabilityId, CapabilityStatus> {
  const installed = usePluginsStore((state) => state.installed)
  const health = usePluginsStore((state) => state.health)
  const { status: midiStatus } = useMidiTrigger()
  const now = useNow()

  return useMemo(
    () =>
      resolveCapabilities(
        installed,
        health,
        { [CAPABILITIES.midiInput]: midiStatus === 'connected' },
        now,
      ),
    [installed, health, midiStatus, now],
  )
}

import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { triggerDeviceControl } from '../lib/deviceControlClient'
import { resolveDeviceClaimEngine } from '../lib/deviceClaimEngine'
import { triggerShowControl } from '../lib/showControlClient'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { CueGrid, type CueAction } from './CueGrid'

const ACTIONS: CueAction[] = [
  { label: 'Strobo', type: 'strobe' },
  { label: 'Blackout', type: 'blackout' },
  { label: 'Kaltfunken', type: 'cold-spark' },
  { label: 'Talkback', type: 'talkback' },
]

/**
 * Ad-hoc show cues, bypassing any song timeline (docs/08 Use Case 4.5) - #3: previously local
 * feedback only, now a real trigger to whichever plugin provides `show-control`, same pattern
 * ShowTransportWidget already established. The widget only ever appears when a matching plugin
 * is installed (registry.tsx's `requires`), so `pluginId` here is rarely null in practice -
 * still checked, since "installed" and "currently reachable" (WidgetFrame's degraded overlay)
 * are different things.
 *
 * These cues route through the same physical target as LightingCuesWidget - mockLightingPlugin
 * (core-backend) declares both `lighting` and `show-control`, since on real hardware they're
 * the same rig - so a claimed `lighting` device (#10) takes over here too, via the relay
 * (deviceControlClient.ts) rather than a second, redundant claim capability.
 */
export function QuickActionsWidget() {
  const installed = usePluginsStore((state) => state.installed)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const claimedDeviceId = useShowStateStore((state) => state.state.deviceClaims[CAPABILITIES.lighting])
  const pluginId = claimedDeviceId === undefined ? pluginProviding(installed, CAPABILITIES.showControl) : null
  const engine = resolveDeviceClaimEngine(claimedDeviceId, deviceId, pluginId)
  const [error, setError] = useState<string | null>(null)

  async function fire(type: string) {
    if (engine === 'local-mine') {
      useLocalLightingStore.getState().applyEvent({ type })
      return
    }
    if (engine === 'local-other') {
      const result = await triggerDeviceControl(workspaceId, claimedDeviceId!, CAPABILITIES.lighting, { type })
      setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
      return
    }
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, { type })
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <CueGrid actions={ACTIONS} onFire={(type) => void fire(type)} />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

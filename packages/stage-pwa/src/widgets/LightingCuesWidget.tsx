import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { triggerDeviceControl } from '../lib/deviceControlClient'
import { resolveHardwareEngine } from '../lib/hardwareRouting'
import { useHardwareBindingFor } from '../lib/useHardwareBindingFor'
import { triggerShowControl } from '../lib/showControlClient'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { CueGrid, type CueAction } from './CueGrid'

const ACTIONS: CueAction[] = [
  { label: 'Voll', type: 'full' },
  { label: 'Dimmen', type: 'dim' },
  { label: 'Chase', type: 'chase' },
  { label: 'Farbwechsel', type: 'color-change' },
]

/**
 * DMX/lighting-desk cues (docs/07) - #3: previously local feedback only, now a real trigger to
 * whichever plugin provides `lighting`, same pattern ShowTransportWidget already established.
 * #10 (Logical Devices & Hardware Setup Profiles): a `lighting` binding in the active
 * HardwareSetup takes over here instead of the plugin, via the relay (deviceControlClient.ts)
 * when it's a different tablet, or straight into useLocalLightingStore when it's this one -
 * QuickActionsWidget's ad-hoc cues share the same binding, since they're the same physical rig.
 */
export function LightingCuesWidget() {
  const installed = usePluginsStore((state) => state.installed)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const binding = useHardwareBindingFor(CAPABILITIES.lighting)
  const pluginId = binding === null ? pluginProviding(installed, CAPABILITIES.lighting) : null
  const engine = resolveHardwareEngine(binding, deviceId, pluginId)
  const lastCue = useLocalLightingStore((state) => state.lastCue)
  const [error, setError] = useState<string | null>(null)

  async function fire(type: string) {
    if (engine === 'local-mine') {
      useLocalLightingStore.getState().applyEvent({ type })
      return
    }
    if (engine === 'local-other') {
      const result = await triggerDeviceControl(workspaceId, binding!.executionTarget, CAPABILITIES.lighting, { type })
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
      {engine === 'local-mine' && lastCue && (
        <p className="text-xs text-ink-faint">Zuletzt: {lastCue}</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

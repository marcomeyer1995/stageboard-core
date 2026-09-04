import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { triggerShowControl } from '../lib/showControlClient'
import { usePluginsStore } from '../store/usePluginsStore'
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
 */
export function LightingCuesWidget() {
  const installed = usePluginsStore((state) => state.installed)
  const pluginId = pluginProviding(installed, CAPABILITIES.lighting)
  const [error, setError] = useState<string | null>(null)

  async function fire(type: string) {
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

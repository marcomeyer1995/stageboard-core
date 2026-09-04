import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { triggerShowControl } from '../lib/showControlClient'
import { usePluginsStore } from '../store/usePluginsStore'
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
 */
export function QuickActionsWidget() {
  const installed = usePluginsStore((state) => state.installed)
  const pluginId = pluginProviding(installed, CAPABILITIES.showControl)
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

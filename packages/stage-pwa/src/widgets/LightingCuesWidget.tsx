import i18n from '../i18n'
import { useTranslation } from 'react-i18next'
import { useShowPart } from '../lib/widgetParts'
import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { getTranslator, supportsLocalExecution } from '../lib/clientTranslator'
import { triggerDeviceControl } from '../lib/deviceControlClient'
import { useDynamicTranslatorPreload } from '../lib/useDynamicTranslatorPreload'
import { resolveHardwareEngine } from '../lib/hardwareRouting'
import { useHardwareBindingFor } from '../lib/useHardwareBindingFor'
import { triggerShowControl } from '../lib/showControlClient'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { CueGrid, type CueAction } from './CueGrid'
import { DEFAULT_SIZE_RATIO, type CueGridConfig } from './cueGridConfig'
import { stageFontSize } from '../lib/stageSize'

const ACTIONS: CueAction[] = [
  {
    get label() {
      return i18n.t('widgets:light.full')
    },
    type: 'full',
  },
  {
    get label() {
      return i18n.t('widgets:light.dim')
    },
    type: 'dim',
  },
  {
    get label() {
      return i18n.t('widgets:light.chase')
    },
    type: 'chase',
  },
  {
    get label() {
      return i18n.t('widgets:light.color')
    },
    type: 'color-change',
  },
]

/**
 * DMX/lighting-desk cues (docs/07) - #3: previously local feedback only, now a real trigger to
 * whichever plugin provides `lighting`, same pattern ShowTransportWidget already established.
 * #10 (Logical Devices & Hardware Setup Profiles): a `lighting` binding in the active
 * HardwareSetup takes over here instead of the plugin, via the relay (deviceControlClient.ts)
 * when it's a different tablet, or straight into useLocalLightingStore when it's this one -
 * QuickActionsWidget's ad-hoc cues share the same binding, since they're the same physical rig.
 */
export function LightingCuesWidget({ config }: { config: CueGridConfig }) {
  const { t } = useTranslation('widgets')
  // Parts left out under "Anzeigen" in the ⋯ menu (Marco, 2026-10-17: declutter every widget).
  const showLast = useShowPart('last')
  const installed = usePluginsStore((state) => state.installed)
  useDynamicTranslatorPreload(CAPABILITIES.lighting, installed)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const binding = useHardwareBindingFor(CAPABILITIES.lighting)
  const pluginId = binding === null ? pluginProviding(installed, CAPABILITIES.lighting) : null
  const engine = resolveHardwareEngine(binding, deviceId, pluginId, supportsLocalExecution(installed, CAPABILITIES.lighting))
  const lastCue = useLocalLightingStore((state) => state.lastCue)
  const [error, setError] = useState<string | null>(null)
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  async function fire(type: string) {
    if (engine === 'local-mine') {
      void getTranslator(CAPABILITIES.lighting)!({ type })
      return
    }
    if (engine === 'local-other') {
      const result = await triggerDeviceControl(workspaceId, binding!.executionTarget!, CAPABILITIES.lighting, { type })
      setError(result.status === 'error' ? (result.message ?? t('w.error')) : null)
      return
    }
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, { type })
    setError(result.status === 'error' ? (result.message ?? t('w.error')) : null)
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <CueGrid actions={ACTIONS} onFire={(type) => void fire(type)} fontSize={fontSize} />
      </div>
      {showLast && engine === 'local-mine' && lastCue && (
        <p className="text-xs text-ink-faint">Zuletzt: {lastCue}</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

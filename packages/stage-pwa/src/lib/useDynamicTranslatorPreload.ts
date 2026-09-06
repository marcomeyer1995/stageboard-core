import { useEffect, useState } from 'react'
import type { CapabilityId, PluginInstallation } from 'shared-types'
import { preloadDynamicTranslator } from './clientTranslator'
import { getStageServerUrl } from './stageServer'

/**
 * Kicks off `preloadDynamicTranslator` (clientTranslator.ts) for `capability` on mount/whenever
 * `installed` changes, ahead of the first trigger - and forces one re-render once it resolves,
 * since `hasClientTranslator`/`getTranslator`'s in-memory cache isn't itself reactive (a plain
 * module-level Map, not a store): without this, a widget that rendered before the dynamic
 * Translator finished loading would never notice it became available. A no-op re-render (or
 * none at all) whenever nothing was actually loaded.
 *
 * Called once per capability-routed widget (IemWidget, LightingCuesWidget, QuickActionsWidget),
 * same place each already reads `installed` for its own `pluginProviding`/`supportsLocalExecution`
 * calls - #109.
 */
export function useDynamicTranslatorPreload(capability: CapabilityId, installed: PluginInstallation[]): void {
  const [, forceRerender] = useState(0)

  useEffect(() => {
    let cancelled = false
    void preloadDynamicTranslator(capability, installed, getStageServerUrl() ?? null).then(() => {
      if (!cancelled) forceRerender((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [capability, installed])
}

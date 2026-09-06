import { CAPABILITIES, type CapabilityId, type PluginInstallation, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { useLocalMixerStore } from '../store/useLocalMixerStore'

/**
 * What a client-side plugin does with a fired event, running entirely on this tablet - the
 * browser-side sibling of core-backend's `IShowControlPlugin.trigger` (#98). #101 will replace
 * this static registry with real, dynamically `import()`ed plugin modules; until then, every
 * entry here corresponds 1:1 to a `runtime: 'client' | 'both'` catalog entry in
 * PluginManager.tsx, and is exactly what that plugin's Translator does today.
 */
export type Translator = (event: ShowControlEvent) => Promise<ShowControlResult> | ShowControlResult

const TRANSLATORS: Partial<Record<CapabilityId, Translator>> = {
  [CAPABILITIES.mixer]: (event) => useLocalMixerStore.getState().applyEvent(event),
  [CAPABILITIES.lighting]: (event) => useLocalLightingStore.getState().applyEvent(event),
}

/**
 * Whether an enabled client-runtime plugin actually backs `capability` on this build - the
 * same gate `pluginProviding` (capabilities.ts) already applies to server plugins, mirrored
 * here so HardwareSetup routing can't silently promise local execution nothing implements
 * (found while building #10's admin UI: the ExecutionTarget picker offered any tablet for any
 * capability, including ones with only a mock local store and no real installed plugin at all).
 */
export function hasClientTranslator(installed: PluginInstallation[], capability: CapabilityId): boolean {
  if (!(capability in TRANSLATORS)) return false
  return installed.some(
    (plugin) =>
      plugin.enabled &&
      (plugin.runtime === 'client' || plugin.runtime === 'both') &&
      plugin.capabilities.includes(capability),
  )
}

/** Null whenever `hasClientTranslator` would be false for the same capability - callers that
 * already checked it can assert non-null. */
export function getTranslator(capability: CapabilityId): Translator | null {
  return TRANSLATORS[capability] ?? null
}

/**
 * Whether a tablet can meaningfully be the execution target for `capability` at all - either a
 * real client-runtime plugin backs it (`hasClientTranslator`), or - `audio-playback` only - the
 * browser's own native `<audio>` element does the job with no plugin involved at all
 * (localAudioEngine.ts, ShowTransportWidget.tsx). Used to gate both HardwareSetup routing and
 * HardwareSetupManager's admin UI, so "route to a tablet" is never offered/honored for a
 * capability nothing can actually execute there.
 */
export function supportsLocalExecution(installed: PluginInstallation[], capability: CapabilityId): boolean {
  return capability === CAPABILITIES.audioPlayback || hasClientTranslator(installed, capability)
}

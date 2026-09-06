import { CAPABILITIES, type CapabilityId, type PluginInstallation, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { loadClientPlugin } from './loadClientPlugin'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { useLocalMixerStore } from '../store/useLocalMixerStore'

/**
 * What a client-side plugin does with a fired event, running entirely on this tablet - the
 * browser-side sibling of core-backend's `IShowControlPlugin.trigger` (#98). Every entry here
 * corresponds 1:1 to a `runtime: 'client' | 'both'` catalog entry in PluginManager.tsx, and is
 * exactly what that plugin's Translator does today - the two mock capabilities' still-bundled
 * stand-in for a real plugin's own `ClientPluginModule.registerTranslator` (#101/#109), which a
 * *dynamically* loaded plugin provides instead, via `dynamicTranslators` below.
 */
export type Translator = (event: ShowControlEvent) => Promise<ShowControlResult> | ShowControlResult

const TRANSLATORS: Partial<Record<CapabilityId, Translator>> = {
  [CAPABILITIES.mixer]: (event) => useLocalMixerStore.getState().applyEvent(event),
  [CAPABILITIES.lighting]: (event) => useLocalLightingStore.getState().applyEvent(event),
}

/** Translators registered by a dynamically-loaded plugin (#109), keyed by capability - filled
 * in by `preloadDynamicTranslator` below, read by `hasClientTranslator`/`getTranslator`
 * alongside the static registry above. Deliberately never evicted when a plugin is later
 * disabled/uninstalled: `hasClientTranslator` re-checks `installed`/`enabled` on every call
 * regardless of whether the code happens to still be cached here, so a stale entry is inert,
 * not wrong - the next enable reuses it instead of re-fetching. Cleared naturally on reload. */
const dynamicTranslators = new Map<CapabilityId, Translator>()
const pendingDynamicLoads = new Map<CapabilityId, Promise<void>>()

/**
 * Kicks off (once, deduped across concurrent callers) loading `capability`'s Translator from
 * whichever enabled plugin providing it declares a `clientSource` - a no-op, resolved
 * immediately, when the capability already has a static Translator, one is already loaded, or
 * no qualifying plugin has a `clientSource` at all. Meant to be called ahead of the first
 * trigger (a widget's mount effect, `useDynamicTranslatorPreload.ts`), never from the trigger
 * itself, so firing never stalls on a first-time fetch.
 */
export function preloadDynamicTranslator(
  capability: CapabilityId,
  installed: PluginInstallation[],
  stageServerUrl: string | null,
): Promise<void> {
  if (TRANSLATORS[capability] || dynamicTranslators.has(capability)) return Promise.resolve()
  const pending = pendingDynamicLoads.get(capability)
  if (pending) return pending

  const plugin = installed.find(
    (candidate) => candidate.enabled && candidate.capabilities.includes(capability) && candidate.clientSource,
  )
  if (!plugin) return Promise.resolve()

  const promise = loadClientPlugin(plugin, stageServerUrl)
    .then((module) => {
      const translator = module?.registerTranslator?.(capability)
      if (translator) dynamicTranslators.set(capability, translator)
    })
    .catch(() => {
      // Same "nothing to use here" convention loadClientPlugin itself already follows for a
      // failed fetch/import - hasClientTranslator below just keeps reporting false.
    })
    .finally(() => pendingDynamicLoads.delete(capability))
  pendingDynamicLoads.set(capability, promise)
  return promise
}

/**
 * Whether an enabled client-runtime plugin actually backs `capability` on this build - the
 * same gate `pluginProviding` (capabilities.ts) already applies to server plugins, mirrored
 * here so HardwareSetup routing can't silently promise local execution nothing implements
 * (found while building #10's admin UI: the ExecutionTarget picker offered any tablet for any
 * capability, including ones with only a mock local store and no real installed plugin at all).
 * Counts a dynamically-loaded Translator (`dynamicTranslators` above) exactly like a static one
 * once it's ready - still gated on `enabled` here regardless, so disabling the plugin correctly
 * stops routing to it even though the loaded code stays cached.
 */
export function hasClientTranslator(installed: PluginInstallation[], capability: CapabilityId): boolean {
  if (!(capability in TRANSLATORS) && !dynamicTranslators.has(capability)) return false
  return installed.some(
    (plugin) =>
      plugin.enabled &&
      (plugin.runtime === 'client' || plugin.runtime === 'both') &&
      plugin.capabilities.includes(capability),
  )
}

/** Null whenever `hasClientTranslator` would be false for the same capability - callers that
 * already checked it can assert non-null. Static registry wins on the (today, impossible) off
 * chance a capability somehow has both. */
export function getTranslator(capability: CapabilityId): Translator | null {
  return TRANSLATORS[capability] ?? dynamicTranslators.get(capability) ?? null
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

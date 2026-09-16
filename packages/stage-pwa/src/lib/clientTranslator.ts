import { CAPABILITIES, type CapabilityId, type PluginInstallation, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { CQ18T_CAPABILITY, cq18tTranslator } from './cq18tTranslator'
import { KEMPER_CAPABILITY, kemperTranslator } from './kemperTranslator'
import { MG30_CAPABILITY, mg30Translator } from './mg30Translator'
import { RC500_CAPABILITY, rc500Translator } from './rc500Translator'
import { UI24R_CAPABILITY, ui24rTranslator } from './ui24rTranslator'
import { loadClientPlugin } from './loadClientPlugin'
import { useLocalLightingStore } from '../store/useLocalLightingStore'
import { useLocalMixerStore } from '../store/useLocalMixerStore'

/**
 * The `click-track` capability's own Translator (#231) - unlike every other entry in
 * `TRANSLATORS` below, `click-track`/`audio-playback` normally need no Translator at all
 * (`supportsLocalExecution`'s own doc comment: a browser-native API does the job). The one
 * exception is this single event: pushing the current entry's auto-stop point forward by N
 * bars, fired from CustomTriggerWidget (dashboard button) or, once that binding exists, a
 * footswitch/MIDI controller - both reuse this exact generic dispatch path, no new mechanism.
 * Routes to Gig's `extendClickTrack` (queue.ts, Master-gated) or Practice's
 * `practiceExtendClickTrack` (practiceQueue.ts, ungated) depending on the current session mode -
 * this module has no React context to read `useShowMode()` from, so it checks the plain store
 * directly instead, same as `useAppModeStore.ts`'s own `isModePlaying` does.
 *
 * `queue.ts`/`practiceQueue.ts`/`useAppModeStore.ts` are all deliberately dynamic `import()`s
 * here, not static ones - every other Translator in this file only ever needs
 * `useLogicalDevicesStore`/`useDeviceTransportConfigStore` (both mocked in every driver/widget
 * test that touches this module), while these three transitively construct a real workspace
 * PouchDB at module load (`useWorkspaceStore.ts` -> `workspaceDb.ts`) - a static import broke
 * every test exercising this file that doesn't itself mock that whole chain (found while
 * implementing this very translator, 2026-09-16).
 *
 * Only the press (`active` absent or `true`) does anything - a momentary trigger's release
 * (`active: false`) is deliberately ignored, since extending is a one-shot action, not something
 * that should also fire again on release.
 */
async function applyClickTrackEvent(event: ShowControlEvent): Promise<ShowControlResult> {
  if (event.type !== 'click.extend') {
    return { status: 'error', message: `Unbekannter Click-Track-Befehl: ${event.type}` }
  }
  if (event.payload?.active === false) return { status: 'ok' }
  const bars = Number(event.payload?.bars)
  if (!Number.isInteger(bars) || bars <= 0) {
    return { status: 'error', message: 'click.extend: bars muss eine positive Ganzzahl sein.' }
  }
  const { useAppModeStore } = await import('../store/useAppModeStore')
  if (useAppModeStore.getState().mode === 'practice') {
    const { practiceExtendClickTrack } = await import('./practiceQueue')
    practiceExtendClickTrack(bars)
  } else {
    const { extendClickTrack } = await import('./queue')
    await extendClickTrack(bars)
  }
  return { status: 'ok', data: { bars } }
}

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
  [CAPABILITIES.clickTrack]: applyClickTrackEvent,
  [KEMPER_CAPABILITY]: kemperTranslator,
  [CQ18T_CAPABILITY]: cq18tTranslator,
  [MG30_CAPABILITY]: mg30Translator,
  [RC500_CAPABILITY]: rc500Translator,
  [UI24R_CAPABILITY]: ui24rTranslator,
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
 * real client-runtime plugin backs it (`hasClientTranslator`), or - `audio-playback`/
 * `click-track` only - a browser-native API does the job with no plugin involved at all
 * (localAudioEngine.ts's `<audio>` element; clickEngine.ts's Web Audio scheduler, #25). Used to
 * gate both HardwareSetup routing and HardwareSetupManager's admin UI, so "route to a tablet" is
 * never offered/honored for a capability nothing can actually execute there.
 */
export function supportsLocalExecution(installed: PluginInstallation[], capability: CapabilityId): boolean {
  return (
    capability === CAPABILITIES.audioPlayback ||
    capability === CAPABILITIES.clickTrack ||
    hasClientTranslator(installed, capability)
  )
}

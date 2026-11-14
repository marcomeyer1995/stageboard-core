import { coalesced } from '../lib/coalesced'
import type { LocalChangesHandle } from '../lib/localChanges'
import { create } from 'zustand'
import { DEFAULT_PLUGIN_HEALTH, type PluginHealth, type PluginInstallation } from 'shared-types'
import {
  getAllPlugins,
  pluginsChanges,
  putPlugin,
  removePlugin,
  switchPluginsWorkspace,
  type PluginInstallationDoc,
} from '../lib/pluginsDb'
import { subscribeToPluginHealth } from '../lib/pluginHealthStream'
import { catalogEntry } from '../lib/pluginCatalog'

function toInstallation(doc: PluginInstallationDoc): PluginInstallation {
  // A built-in add-on installed before `apiVersion`/`permissions`/`helpers` existed (#756) gets
  // them from the catalog of this build; an add-on from elsewhere only has what its manifest says.
  const builtIn = catalogEntry(doc.id)
  return {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    source: doc.source,
    clientSource: doc.clientSource,
    runtime: doc.runtime,
    capabilities: doc.capabilities,
    // A plugin installed before `transports`/`hardwareIds` existed (#100/#106) simply lacks the
    // key - same read-time fallback spirit as useSongVariantsStore's `cues` one.
    transports: doc.transports ?? [],
    hardwareIds: doc.hardwareIds ?? [],
    enabled: doc.enabled,
    installedAt: doc.installedAt,
    ...(doc.settings ? { settings: doc.settings } : {}),
    ...(doc.timing ? { timing: doc.timing } : {}),
    ...(doc.discoveryTrigger ? { discoveryTrigger: doc.discoveryTrigger } : {}),
    ...pick(doc, builtIn, 'apiVersion'),
    ...pick(doc, builtIn, 'permissions'),
    ...pick(doc, builtIn, 'helpers'),
  }
}

/** `key` from the document, else from the built-in catalog entry, else nothing. */
function pick<K extends 'apiVersion' | 'permissions' | 'helpers'>(
  doc: PluginInstallationDoc,
  builtIn: Pick<PluginInstallation, K> | undefined,
  key: K,
): Partial<Pick<PluginInstallation, K>> {
  const value = doc[key] ?? builtIn?.[key]
  return value === undefined ? {} : ({ [key]: value } as Pick<PluginInstallation, K>)
}

interface PluginsState {
  installed: PluginInstallation[]
  health: PluginHealth
  /** The first status from the Stage-Server has arrived - before that `health` is only the empty default. */
  healthReceived: boolean
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  install: (installation: PluginInstallation) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  /** Merges into the plugin's band-wide settings (e.g. piper-speech's voice, #63). */
  updateSettings: (id: string, patch: Record<string, unknown>) => Promise<void>
  uninstall: (id: string) => Promise<void>
}

let changesHandle: LocalChangesHandle<PluginInstallation> | null = null
let unsubscribeHealth: (() => void) | null = null

async function refresh(set: (partial: Partial<PluginsState>) => void) {
  const docs = await getAllPlugins()
  set({ installed: docs.map(toInstallation) })
}

export const usePluginsStore = create<PluginsState>((set, get) => ({
  installed: [],
  health: DEFAULT_PLUGIN_HEALTH,
  healthReceived: false,
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    unsubscribeHealth?.()
    unsubscribeHealth = null
    switchPluginsWorkspace(workspaceId)
    set({ installed: [], health: DEFAULT_PLUGIN_HEALTH, healthReceived: false, loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = pluginsChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))

    unsubscribeHealth = subscribeToPluginHealth(workspaceId, (health) => set({ health, healthReceived: true }))
  },
  install: async (installation) => {
    await putPlugin(installation)
  },
  setEnabled: async (id, enabled) => {
    const existing = get().installed.find((plugin) => plugin.id === id)
    if (!existing) return
    await putPlugin({ ...existing, enabled })
  },
  updateSettings: async (id, patch) => {
    const existing = get().installed.find((plugin) => plugin.id === id)
    if (!existing) return
    await putPlugin({ ...existing, settings: { ...existing.settings, ...patch } })
  },
  uninstall: async (id) => {
    await removePlugin(id)
  },
}))

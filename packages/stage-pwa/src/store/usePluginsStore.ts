import { create } from 'zustand'
import { DEFAULT_PLUGIN_HEALTH, type PluginHealth, type PluginInstallation } from 'shared-types'
import {
  getAllPlugins,
  getPluginsDb,
  putPlugin,
  removePlugin,
  switchPluginsWorkspace,
  type PluginInstallationDoc,
} from '../lib/pluginsDb'
import { subscribeToPluginHealth } from '../lib/pluginHealthStream'

function toInstallation(doc: PluginInstallationDoc): PluginInstallation {
  return {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    source: doc.source,
    runtime: doc.runtime,
    capabilities: doc.capabilities,
    enabled: doc.enabled,
    installedAt: doc.installedAt,
  }
}

interface PluginsState {
  installed: PluginInstallation[]
  health: PluginHealth
  loaded: boolean
  init: (workspaceId: string) => Promise<void>
  install: (installation: PluginInstallation) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  uninstall: (id: string) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<PluginInstallation> | null = null
let unsubscribeHealth: (() => void) | null = null

async function refresh(set: (partial: Partial<PluginsState>) => void) {
  const docs = await getAllPlugins()
  set({ installed: docs.map(toInstallation) })
}

export const usePluginsStore = create<PluginsState>((set, get) => ({
  installed: [],
  health: DEFAULT_PLUGIN_HEALTH,
  loaded: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    unsubscribeHealth?.()
    unsubscribeHealth = null
    switchPluginsWorkspace(workspaceId)
    set({ installed: [], health: DEFAULT_PLUGIN_HEALTH, loaded: false })

    await refresh(set)
    set({ loaded: true })

    changesHandle = getPluginsDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))

    unsubscribeHealth = subscribeToPluginHealth(workspaceId, (health) => set({ health }))
  },
  install: async (installation) => {
    await putPlugin(installation)
  },
  setEnabled: async (id, enabled) => {
    const existing = get().installed.find((plugin) => plugin.id === id)
    if (!existing) return
    await putPlugin({ ...existing, enabled })
  },
  uninstall: async (id) => {
    await removePlugin(id)
  },
}))

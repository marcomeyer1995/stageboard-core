import type { PluginInstallation } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type PluginInstallationDoc = Doc<PluginInstallation>

/**
 * Installed plugins replicate per workspace: installing one on any tablet distributes it
 * across the whole stage mesh (every other tablet and the Stage-Server) through CouchDB.
 */
const plugins = createWorkspaceCollection<PluginInstallation>('plugins')

export const getPluginsDb = plugins.getDb
export const switchPluginsWorkspace = plugins.switchWorkspace
export const getAllPlugins = plugins.getAll
export const putPlugin = plugins.put
export const removePlugin = plugins.remove
export const startPluginsSync = plugins.startSync

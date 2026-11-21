import { PluginInstallationSchema } from 'shared-types'
import { allDocs, type DatabaseConfig } from '../database.js'
import { workspaceDbName } from 'sync-host'

/** Whether the band has the add-on installed and switched on - read from its replicated PluginInstallation documents. */
export async function bandHasAddon(database: DatabaseConfig, workspaceId: string, pluginId: string): Promise<boolean> {
  const docs = await allDocs<unknown>(database, workspaceDbName(workspaceId), { startkey: 'plugins:', endkey: 'plugins:￰' })
  return docs.some((doc) => {
    const parsed = PluginInstallationSchema.safeParse(doc)
    return parsed.success && parsed.data.id === pluginId && parsed.data.enabled
  })
}

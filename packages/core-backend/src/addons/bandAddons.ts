import { allDocs, type DatabaseConfig } from '../database.js'
import { bandHasAddonIn, workspaceDbName } from 'sync-host'

/** Whether the band has the add-on installed and switched on - sync-host's rule over this host's database. */
export async function bandHasAddon(database: DatabaseConfig, workspaceId: string, pluginId: string): Promise<boolean> {
  return bandHasAddonIn(await allDocs<unknown>(database, workspaceDbName(workspaceId), { startkey: 'plugins:', endkey: 'plugins:\ufff0' }), pluginId)
}

import PouchDB from 'pouchdb-browser'
import { DEFAULT_PLUGIN_HEALTH, type PluginHealth } from 'shared-types'
import { ensureRemoteDbExists, localDbName, remoteAuth, remoteDbUrl } from './workspaceDb'

const PLUGIN_HEALTH_DOC_ID = 'plugin-health'

/**
 * Runtime health of the server-side plugins. Written by the Stage-Server, read by every
 * tablet - it shares the per-workspace `meta` database with the show state, so it needs
 * no extra replication of its own.
 */
let db = new PouchDB<PluginHealth>(localDbName('meta', 'default'))
let syncHandle: PouchDB.Replication.Sync<PluginHealth> | null = null

export function getPluginHealthDb(): PouchDB.Database<PluginHealth> {
  return db
}

export function switchPluginHealthWorkspace(workspaceId: string): PouchDB.Database<PluginHealth> {
  syncHandle?.cancel()
  syncHandle = null
  db = new PouchDB<PluginHealth>(localDbName('meta', workspaceId))
  return db
}

export async function getPluginHealth(): Promise<PluginHealth> {
  try {
    return await db.get(PLUGIN_HEALTH_DOC_ID)
  } catch {
    return { ...DEFAULT_PLUGIN_HEALTH }
  }
}

/** Same synchronous-on-purpose reasoning as workspaceCollection.ts's startSync. */
export function startPluginHealthSync(
  workspaceId: string,
): PouchDB.Replication.Sync<PluginHealth> | null {
  const url = remoteDbUrl('meta', workspaceId)
  if (!url) return null

  ensureRemoteDbExists(url).catch((err) => {
    console.error('Failed to provision remote meta database', err)
  })

  const remoteDb = new PouchDB<PluginHealth>(url, { auth: remoteAuth() })
  syncHandle = db.sync(remoteDb, { live: true, retry: true })
  return syncHandle
}

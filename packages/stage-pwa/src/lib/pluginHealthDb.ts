import PouchDB from 'pouchdb-browser'
import { DEFAULT_PLUGIN_HEALTH, type PluginHealth } from 'shared-types'
import { trackedSync, type TrackedSync } from './trackedSync'
import { ensureRemoteDbExists, localDbName, remoteAuth, remoteDbUrl } from './workspaceDb'

/** Also used by showStateDb.ts to keep this heartbeat doc from counting as real sync
 * activity in the indicator - they share this one 'meta' database (see #33 follow-up). */
export const PLUGIN_HEALTH_DOC_ID = 'plugin-health'

/**
 * Runtime health of the server-side plugins. Written by the Stage-Server, read by every
 * tablet - it shares the per-workspace `meta` database with the show state, so it needs
 * no extra replication of its own.
 */
let db = new PouchDB<PluginHealth>(localDbName('meta', 'default'))
let syncHandle: TrackedSync | null = null

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
export function startPluginHealthSync(workspaceId: string): TrackedSync | null {
  const url = remoteDbUrl('meta', workspaceId)
  if (!url) return null

  ensureRemoteDbExists(url).catch((err) => {
    console.error('Failed to provision remote meta database', err)
  })

  const remoteDb = new PouchDB<PluginHealth>(url, { auth: remoteAuth() })
  syncHandle = trackedSync('plugin-health', db, remoteDb)
  return syncHandle
}

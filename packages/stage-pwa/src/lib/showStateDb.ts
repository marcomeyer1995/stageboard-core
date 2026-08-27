import PouchDB from 'pouchdb-browser'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { PLUGIN_HEALTH_DOC_ID } from './pluginHealthDb'
import { trackedSync, type TrackedSync } from './trackedSync'
import { ensureRemoteDbExists, localDbName, remoteAuth, remoteDbUrl } from './workspaceDb'

const SHOW_STATE_DOC_ID = 'show-state'

let db = new PouchDB<ShowState>(localDbName('meta', 'default'))
let syncHandle: TrackedSync | null = null

export function getShowStateDb(): PouchDB.Database<ShowState> {
  return db
}

export function switchShowStateWorkspace(workspaceId: string): PouchDB.Database<ShowState> {
  syncHandle?.cancel()
  syncHandle = null
  db = new PouchDB<ShowState>(localDbName('meta', workspaceId))
  return db
}

export async function getShowState(): Promise<ShowState> {
  try {
    const doc = await db.get(SHOW_STATE_DOC_ID)
    // A doc written before activeEntryId existed (it was activeSongId) simply lacks the key -
    // merging over the default fills it in as null rather than leaking `undefined` through.
    return { ...DEFAULT_SHOW_STATE, ...doc }
  } catch {
    return { ...DEFAULT_SHOW_STATE }
  }
}

export async function putShowState(patch: Partial<ShowState>): Promise<void> {
  const existing = await db.get(SHOW_STATE_DOC_ID).catch(() => null)
  const merged: ShowState = { ...DEFAULT_SHOW_STATE, ...existing, ...patch }
  const doc: PouchDB.Core.PutDocument<ShowState> = existing
    ? { ...merged, _id: SHOW_STATE_DOC_ID, _rev: existing._rev }
    : { ...merged, _id: SHOW_STATE_DOC_ID }
  await db.put(doc)
}

/** Same synchronous-on-purpose reasoning as workspaceCollection.ts's startSync. */
export function startShowStateSync(workspaceId: string): TrackedSync | null {
  const url = remoteDbUrl('meta', workspaceId)
  if (!url) return null

  ensureRemoteDbExists(url).catch((err) => {
    console.error('Failed to provision remote meta database', err)
  })

  const remoteDb = new PouchDB<ShowState>(url, { auth: remoteAuth() })
  // Excludes the plugin-health heartbeat doc from counting as sync activity - it shares
  // this 'meta' database and writes every few seconds by design (see #33 follow-up).
  syncHandle = trackedSync('show-state', db, remoteDb, {
    isNoiseDocId: (id) => id === PLUGIN_HEALTH_DOC_ID,
  })
  return syncHandle
}

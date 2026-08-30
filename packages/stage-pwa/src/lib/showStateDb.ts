import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { getWorkspaceDb } from './workspaceDb'

/** A bare, unprefixed id - a reserved singleton, not a plural "kind" of many documents, so
 * there's no collision risk with any `${kind}:` prefix a real collection might use. */
const SHOW_STATE_DOC_ID = 'show-state'

let db = getWorkspaceDb<ShowState>('default')

export function getShowStateDb(): PouchDB.Database<ShowState> {
  return db
}

export function switchShowStateWorkspace(workspaceId: string): PouchDB.Database<ShowState> {
  db = getWorkspaceDb<ShowState>(workspaceId)
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

/** Local-only, filtered to just the show-state doc - the shared workspace db holds every
 * other collection's docs too (see workspaceCollection.ts's `changes` for the same reasoning). */
export function showStateChanges(
  options: PouchDB.Core.ChangesOptions,
): PouchDB.Core.Changes<ShowState> {
  return db.changes({ ...options, filter: (doc) => doc._id === SHOW_STATE_DOC_ID })
}

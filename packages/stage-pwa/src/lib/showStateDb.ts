import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { watchLocalChanges, type LocalChangesHandle } from './localChanges'
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

/** Writes queue up behind each other (per database) - see putShowState. */
const writeQueues = new WeakMap<object, Promise<void>>()
const MAX_PUT_ATTEMPTS = 5

async function writeOnce(target: PouchDB.Database<ShowState>, patch: Partial<ShowState>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const existing = await target.get(SHOW_STATE_DOC_ID).catch(() => null)
    const merged: ShowState = { ...DEFAULT_SHOW_STATE, ...existing, ...patch }
    const doc: PouchDB.Core.PutDocument<ShowState> = existing
      ? { ...merged, _id: SHOW_STATE_DOC_ID, _rev: existing._rev }
      : { ...merged, _id: SHOW_STATE_DOC_ID }
    try {
      await target.put(doc)
      return
    } catch (err) {
      // A replication landed between read and write - read again and re-apply the same patch.
      if ((err as { status?: number }).status !== 409 || attempt >= MAX_PUT_ATTEMPTS) throw err
    }
  }
}

/**
 * Merges `patch` into the show state. Writes are queued one after another and retried on a revision
 * conflict: "Weiter, Weiter, Play" within a second used to overlap, the later write failed with a 409
 * and was silently dropped - the master's own tablet fell back to "BEREIT" while every other device,
 * which got the Play through the Stage-Server push, kept playing (2026-10-10, #468). Same fix as
 * workspaceCollection.ts's queuedWrite.
 */
export function putShowState(patch: Partial<ShowState>): Promise<void> {
  const target = db
  const previous = writeQueues.get(target) ?? Promise.resolve()
  const write = previous.catch(() => {}).then(() => writeOnce(target, patch))
  writeQueues.set(target, write)
  return write
}

/** Live local changes to just the show-state doc, from now on - through the shared feed
 * (localChanges.ts), not a filtered feed of its own. */
export function showStateChanges(): LocalChangesHandle<ShowState> {
  return watchLocalChanges<ShowState>(db as PouchDB.Database<object>, (id) => id === SHOW_STATE_DOC_ID)
}

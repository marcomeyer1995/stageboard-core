import { getWorkspaceDb } from './workspaceDb'

export type Doc<T> = T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta

export interface WorkspaceCollection<T extends { id: string }> {
  getDb: () => PouchDB.Database<T>
  switchWorkspace: (workspaceId: string) => PouchDB.Database<T>
  getAll: () => Promise<Doc<T>[]>
  put: (doc: T) => Promise<void>
  /** Deleting a missing document is a no-op, so callers don't have to check first. */
  remove: (id: string) => Promise<void>
  /** Local-only, filtered to this collection's own docs - the shared workspace db holds
   * every kind, so an unfiltered `.changes()` would fire on every other collection's writes
   * too. Costs nothing over the network: this queries the local PouchDB directly, it isn't
   * the remote sync (see workspaceDb.ts's startWorkspaceSync for that). */
  changes: (options: PouchDB.Core.ChangesOptions) => PouchDB.Core.Changes<T>
  /** The CouchDB `_id` a given application-level id maps to in the shared db - for the rare
   * call site that needs to reach the raw db directly (an attachment op, a doc patch) rather
   * than going through get/put/remove above. */
  docId: (id: string) => string
}

/**
 * A workspace-scoped view over the one shared per-workspace CouchDB database (see
 * workspaceDb.ts) - `kind` prefixes every document's CouchDB `_id` (`${kind}:${doc.id}`) so
 * many document kinds can share one database (and therefore one live sync connection)
 * without colliding, while `_all_docs`' native `startkey`/`endkey` range query scopes reads
 * to just this kind - no secondary index needed. The document body's own `id` field (what
 * every `toX()` mapper actually reads) was already separate from CouchDB's `_id` before this
 * change, so nothing downstream of getAll/put/remove needs to know prefixing exists at all.
 */
export function createWorkspaceCollection<T extends { id: string }>(
  kind: string,
): WorkspaceCollection<T> {
  const prefix = `${kind}:`
  const docId = (id: string) => `${prefix}${id}`
  let db = getWorkspaceDb<T>('default')

  return {
    getDb: () => db,
    docId,

    switchWorkspace: (workspaceId) => {
      db = getWorkspaceDb<T>(workspaceId)
      return db
    },

    getAll: async () => {
      const result = await db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}￰`,
      })
      return result.rows.map((row) => row.doc).filter((doc): doc is Doc<T> => doc !== undefined)
    },

    put: async (doc) => {
      const cdbId = docId(doc.id)
      const existing = await db.get(cdbId).catch(() => null)
      // A revision's _attachments is only carried forward if the new body explicitly
      // repeats the stub metadata - callers here only ever pass the plain content fields,
      // so without this, saving e.g. a song's title after attaching a backing track would
      // silently delete the attachment.
      const putDoc = existing
        ? { ...doc, _id: cdbId, _rev: existing._rev, _attachments: existing._attachments }
        : { ...doc, _id: cdbId }
      await db.put(putDoc as PouchDB.Core.PutDocument<T>)
    },

    remove: async (id) => {
      const existing = await db.get(docId(id)).catch(() => null)
      if (!existing) return
      await db.remove(existing)
    },

    changes: (options) =>
      db.changes({
        ...options,
        filter: (doc) => doc._id.startsWith(prefix),
      }),
  }
}

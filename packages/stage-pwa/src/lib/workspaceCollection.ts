import PouchDB from 'pouchdb-browser'
import { ensureRemoteDbExists, localDbName, remoteAuth, remoteDbUrl } from './workspaceDb'

export type Doc<T> = T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta

export interface WorkspaceCollection<T extends { id: string }> {
  getDb: () => PouchDB.Database<T>
  switchWorkspace: (workspaceId: string) => PouchDB.Database<T>
  getAll: () => Promise<Doc<T>[]>
  put: (doc: T) => Promise<void>
  /** Deleting a missing document is a no-op, so callers don't have to check first. */
  remove: (id: string) => Promise<void>
  /**
   * Stays synchronous on purpose: PouchDB's Sync object is itself thenable,
   * so `await`ing anything that returns it (even indirectly through an
   * async function) unwraps it into its eventual result instead of the live
   * handle. Remote-database provisioning happens in the background instead;
   * `retry: true` absorbs the brief window before it exists.
   */
  startSync: (workspaceId: string) => PouchDB.Replication.Sync<T> | null
}

/** A workspace-scoped, CouchDB-syncable collection of documents shaped like `{ id: string, ... }`. */
export function createWorkspaceCollection<T extends { id: string }>(
  kind: string,
): WorkspaceCollection<T> {
  let db = new PouchDB<T>(localDbName(kind, 'default'))
  let syncHandle: PouchDB.Replication.Sync<T> | null = null

  return {
    getDb: () => db,

    switchWorkspace: (workspaceId) => {
      syncHandle?.cancel()
      syncHandle = null
      db = new PouchDB<T>(localDbName(kind, workspaceId))
      return db
    },

    getAll: async () => {
      const result = await db.allDocs({ include_docs: true })
      return result.rows.map((row) => row.doc).filter((doc): doc is Doc<T> => doc !== undefined)
    },

    put: async (doc) => {
      const existing = await db.get(doc.id).catch(() => null)
      const putDoc = existing
        ? { ...doc, _id: doc.id, _rev: existing._rev }
        : { ...doc, _id: doc.id }
      await db.put(putDoc as PouchDB.Core.PutDocument<T>)
    },

    remove: async (id) => {
      const existing = await db.get(id).catch(() => null)
      if (!existing) return
      await db.remove(existing)
    },

    startSync: (workspaceId) => {
      const url = remoteDbUrl(kind, workspaceId)
      if (!url) return null

      ensureRemoteDbExists(url).catch((err) => {
        console.error(`Failed to provision remote ${kind} database`, err)
      })

      const remoteDb = new PouchDB<T>(url, { auth: remoteAuth() })
      syncHandle = db.sync(remoteDb, { live: true, retry: true })
      return syncHandle
    },
  }
}

import type { AccountDoc, AccountStore } from './bandAccounts.js'

/** The slice of a PouchDB database the accounts use. */
interface Db {
  get(id: string): Promise<Record<string, unknown>>
  put(doc: Record<string, unknown>): Promise<unknown>
  allDocs(options: { startkey: string; endkey: string; include_docs: true }): Promise<{ rows: { doc?: unknown }[] }>
}

/**
 * The band accounts (`sync-host`'s `createBandAccounts`, #960) over the band database the app already holds.
 * A write replaces the document: it finds the current revision itself and tries again when another host
 * changed the document in between.
 */
export function createBandAccountStore(db: Db): AccountStore {
  const read = (id: string) => db.get(id).catch((err: { status?: number }) => {
    if (err.status === 404) return null
    throw err
  })
  return {
    get: async (id) => (await read(id)) as AccountDoc | null,
    async put(doc) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await read(doc._id)
        try {
          await db.put({ ...doc, ...(current?._rev ? { _rev: current._rev } : {}) })
          return
        } catch (err) {
          if ((err as { status?: number }).status !== 409) throw err
        }
      }
      throw new Error(`Could not write ${doc._id}: the document keeps changing`)
    },
    async list(prefix) {
      const rows = await db.allDocs({ startkey: prefix, endkey: `${prefix}￰`, include_docs: true })
      return rows.rows.flatMap((row) => (row.doc ? [row.doc as AccountDoc] : []))
    },
  }
}

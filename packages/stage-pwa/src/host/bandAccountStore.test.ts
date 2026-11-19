import { describe, expect, it } from 'vitest'
import { createBandAccountStore } from './bandAccountStore'

/** A PouchDB-shaped stand-in: documents with revisions, a 409 on a stale write. */
function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>()
  let rev = 0
  return {
    docs,
    get: async (id: string) => {
      const d = docs.get(id)
      if (!d) throw Object.assign(new Error('missing'), { status: 404 })
      return d
    },
    put: async (doc: Record<string, unknown>) => {
      const old = docs.get(doc._id as string)
      if (old && old._rev !== doc._rev) throw Object.assign(new Error('conflict'), { status: 409 })
      docs.set(doc._id as string, { ...doc, _rev: `${++rev}-x` })
    },
    allDocs: async ({ startkey, endkey }: { startkey: string; endkey: string }) => ({
      rows: [...docs.values()].filter((d) => (d._id as string) >= startkey && (d._id as string) <= endkey).map((doc) => ({ doc })),
    }),
  }
}

describe('the band accounts as documents of the app\'s own band database', () => {
  it('writes a new document, replaces it (finding the revision itself) and reads it back', async () => {
    const db = fakeDb()
    const store = createBandAccountStore(db as never)
    await store.put({ _id: 'account:a', name: 'a', roles: ['member'] })
    await store.put({ _id: 'account:a', name: 'a', roles: ['member', 'admin'] })
    expect((await store.get('account:a'))?.roles).toEqual(['member', 'admin'])
  })

  it('answers null for a document that is not there', async () => {
    expect(await createBandAccountStore(fakeDb() as never).get('account:none')).toBeNull()
  })

  it('lists the documents of a prefix and nothing else', async () => {
    const db = fakeDb()
    const store = createBandAccountStore(db as never)
    await store.put({ _id: 'account:a' })
    await store.put({ _id: 'account:b' })
    await store.put({ _id: 'anchor:a' })
    await store.put({ _id: 'songs:x' })
    expect((await store.list('account:')).map((d) => d._id)).toEqual(['account:a', 'account:b'])
  })

  it('writes again when another host changed the document in between (a conflict is retried)', async () => {
    const db = fakeDb()
    const store = createBandAccountStore(db as never)
    await store.put({ _id: 'account:a', roles: ['member'] })
    const realPut = db.put
    let raced = false
    db.put = async (doc) => {
      if (!raced) {
        raced = true
        await realPut({ ...(db.docs.get('account:a') as Record<string, unknown>), roles: ['x'] })
      }
      return realPut(doc)
    }
    await store.put({ _id: 'account:a', roles: ['member', 'admin'] })
    expect((await store.get('account:a'))?.roles).toEqual(['member', 'admin'])
  })
})

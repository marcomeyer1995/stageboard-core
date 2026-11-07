import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import HttpAdapter from 'pouchdb-adapter-http'
import Replication from 'pouchdb-replication'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startBuiltinCouch } from './builtinCouch.js'
import { createUser, ensureDb, getDoc, listDbs, putDoc, putSecurity, verifyUser, type CouchConfig } from './couch.js'

PouchDB.plugin(MemoryAdapter).plugin(HttpAdapter).plugin(Replication)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sb-builtin-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the built-in database host (no CouchDB, docs/25)', () => {
  it('keeps bands, accounts and documents in files across a restart', async () => {
    const first = await startBuiltinCouch({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config: CouchConfig = { url: first.url, user: 'admin', password: 'secret' }
    await ensureDb(config, 'stageboard-band')
    await createUser(config, 'stageboard-band-kai', 'pin-1', ['member'])
    await putDoc(config, 'stageboard-band', { _id: 'song:1', title: 'TNT' })
    await first.close()

    const again = await startBuiltinCouch({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config2: CouchConfig = { ...config, url: again.url }
    try {
      expect(await listDbs(config2)).toEqual(['stageboard-band'])
      expect(await verifyUser(config2, 'stageboard-band-kai', 'pin-1')).toEqual({ name: 'stageboard-band-kai', roles: ['member'] })
      expect(await getDoc(config2, 'stageboard-band', 'song:1')).toMatchObject({ title: 'TNT' })
    } finally {
      await again.close()
    }
  })

  it("a member's tablet syncs its band through it", async () => {
    const host = await startBuiltinCouch({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config: CouchConfig = { url: host.url, user: 'admin', password: 'secret' }
    try {
      await ensureDb(config, 'stageboard-band')
      await createUser(config, 'kai', 'pin-1', ['member'])
      await putSecurity(config, 'stageboard-band', { members: { names: [], roles: ['member'] } })
      const tablet = new PouchDB('kai-tablet', { adapter: 'memory' })
      await tablet.put({ _id: 'setlist:1', name: 'Gig' })
      const remote = new PouchDB(`${host.url}/stageboard-band`, { skip_setup: true, auth: { username: 'kai', password: 'pin-1' } })
      await tablet.replicate.to(remote)
      expect(await getDoc(config, 'stageboard-band', 'setlist:1')).toMatchObject({ name: 'Gig' })
    } finally {
      await host.close()
    }
  })
})

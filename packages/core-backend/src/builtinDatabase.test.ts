import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import HttpAdapter from 'pouchdb-adapter-http'
import Replication from 'pouchdb-replication'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startBuiltinDatabase } from './builtinDatabase.js'
import { createBandAccountsFor } from './bandAccounts.js'
import { ensureDb, getDoc, listDbs, putDoc, putSecurity, type DatabaseConfig } from './database.js'

PouchDB.plugin(MemoryAdapter).plugin(HttpAdapter).plugin(Replication)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sb-builtin-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the built-in database host (no the database, docs/25)', () => {
  it('keeps bands, logins and documents in files across a restart', async () => {
    const first = await startBuiltinDatabase({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config: DatabaseConfig = { url: first.url, user: 'admin', password: 'secret' }
    await ensureDb(config, 'stageboard-band')
    const kai = await createBandAccountsFor(config, { iterations: 1000 })('band').provisionDevice('kai', 'd1', false)
    await putDoc(config, 'stageboard-band', { _id: 'song:1', title: 'TNT' })
    await first.close()

    const again = await startBuiltinDatabase({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config2: DatabaseConfig = { ...config, url: again.url }
    try {
      expect(await listDbs(config2)).toEqual(['stageboard-band'])
      expect(await createBandAccountsFor(config2)('band').login(`Basic ${Buffer.from(`${kai.username}:${kai.password}`).toString('base64')}`)).toEqual({ name: kai.username, roles: ['member'] })
      expect(await getDoc(config2, 'stageboard-band', 'song:1')).toMatchObject({ title: 'TNT' })
    } finally {
      await again.close()
    }
  })

  it('keeps the revision history of a document bounded, so hours of writes do not slow the host down (#962, soak)', async () => {
    const host = await startBuiltinDatabase({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config: DatabaseConfig = { url: host.url, user: 'admin', password: 'secret' }
    try {
      await ensureDb(config, 'stageboard-band')
      let rev: string | undefined
      for (let i = 0; i < 160; i++) {
        const response = await fetch(`${host.url}/stageboard-band/song:1`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` },
          body: JSON.stringify({ _id: 'song:1', ...(rev ? { _rev: rev } : {}), title: `take ${i}` }),
        })
        rev = ((await response.json()) as { rev: string }).rev
      }
      const doc = (await (await fetch(`${host.url}/stageboard-band/song:1?revs=true`, { headers: { authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } })).json()) as { _revisions: { ids: string[] } }
      // A band's documents are edited by a few devices; ancestry beyond a short window is never needed to merge them.
      expect(doc._revisions.ids.length).toBeLessThanOrEqual(50)
    } finally {
      await host.close()
    }
  })

  it("a member's tablet syncs its band through it", async () => {
    const host = await startBuiltinDatabase({ dataDir: dir, user: 'admin', password: 'secret', port: 0 })
    const config: DatabaseConfig = { url: host.url, user: 'admin', password: 'secret' }
    try {
      await ensureDb(config, 'stageboard-band')
      const kai = await createBandAccountsFor(config, { iterations: 1000 })('band').provisionDevice('kai', 'd1', false)
      await putSecurity(config, 'stageboard-band', { members: { names: [], roles: ['member'] } })
      const tablet = new PouchDB('kai-tablet', { adapter: 'memory' })
      await tablet.put({ _id: 'setlist:1', name: 'Gig' })
      const remote = new PouchDB(`${host.url}/stageboard-band`, { skip_setup: true, auth: { username: kai.username, password: kai.password } })
      await tablet.replicate.to(remote)
      expect(await getDoc(config, 'stageboard-band', 'setlist:1')).toMatchObject({ name: 'Gig' })
    } finally {
      await host.close()
    }
  })
})

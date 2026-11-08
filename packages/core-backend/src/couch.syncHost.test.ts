import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import { createCouchHost, type Catalog } from 'sync-host/couch-host'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  allDocs,
  createUser,
  deleteDb,
  deleteDocUnless,
  deleteUser,
  ensureDb,
  getAttachment,
  getDoc,
  listDbs,
  putAttachment,
  putDoc,
  putDocWithRetry,
  putSecurity,
  resetUserPassword,
  setUserRoles,
  userExists,
  verifyUser,
  waitForChange,
  type CouchConfig,
} from './couch.js'

PouchDB.plugin(MemoryAdapter)

// couch.ts unchanged, against the built-in host instead of CouchDB in Docker (docs/25, Host step 1).
let server: Server
let config: CouchConfig

beforeAll(async () => {
  const names = new Set<string>()
  const catalog: Catalog = { list: async () => [...names], add: async (x) => void names.add(x), remove: async (x) => void names.delete(x) }
  const host = createCouchHost({ storage: (name) => new PouchDB(`couchts-${name}`, { adapter: 'memory' }), catalog, admin: { user: 'admin', password: 'secret' }, longpollMaxMs: 1500 })
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const type = req.headers['content-type'] ?? ''
    const body = raw.length === 0 ? undefined : type.includes('json') ? JSON.parse(raw.toString('utf8')) : { data: new Uint8Array(raw), contentType: type }
    const out = await host({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, authorization: req.headers.authorization })
    res.writeHead(out.status, { 'content-type': out.binary?.contentType ?? 'application/json' })
    res.end(out.binary ? Buffer.from(out.binary.data) : JSON.stringify(out.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  config = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, user: 'admin', password: 'secret' }
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('couch.ts against the built-in host (no CouchDB)', () => {
  it('bands, accounts and access rules', async () => {
    await ensureDb(config, 'stageboard-a')
    await ensureDb(config, 'stageboard-a')
    expect(await listDbs(config)).toEqual(['stageboard-a'])
    await createUser(config, 'kai', 'pin-1', ['member'])
    await createUser(config, 'kai', 'other', ['member'])
    expect(await userExists(config, 'kai')).toBe(true)
    expect(await verifyUser(config, 'kai', 'pin-1')).toEqual({ name: 'kai', roles: ['member'] })
    expect(await verifyUser(config, 'kai', 'other')).toBeNull()
    await setUserRoles(config, 'kai', ['member', 'admin'])
    await resetUserPassword(config, 'kai', 'pin-2')
    expect(await verifyUser(config, 'kai', 'pin-2')).toEqual({ name: 'kai', roles: ['member', 'admin'] })
    await putSecurity(config, 'stageboard-a', { members: { names: [], roles: ['member'] } })
    await deleteUser(config, 'kai')
    expect(await userExists(config, 'kai')).toBe(false)
  })

  it('documents, retries, conditional delete, attachments, waiting for a change', async () => {
    await ensureDb(config, 'stageboard-b')
    await putDoc(config, 'stageboard-b', { _id: 'plugin:x', on: true })
    expect(await getDoc(config, 'stageboard-b', 'plugin:x')).toMatchObject({ on: true })
    await putDocWithRetry<{ _id: string; _rev?: string; n: number }>(config, 'stageboard-b', 'counter', (old) => ({ _id: 'counter', ...(old?._rev ? { _rev: old._rev } : {}), n: (old?.n ?? 0) + 1 }))
    await putDocWithRetry<{ _id: string; _rev?: string; n: number }>(config, 'stageboard-b', 'counter', (old) => ({ _id: 'counter', ...(old?._rev ? { _rev: old._rev } : {}), n: (old?.n ?? 0) + 1 }))
    expect(await getDoc(config, 'stageboard-b', 'counter')).toMatchObject({ n: 2 })
    expect(await allDocs(config, 'stageboard-b', { startkey: 'plugin:', endkey: 'plugin:￿' })).toHaveLength(1)
    expect(await deleteDocUnless(config, 'stageboard-b', 'plugin:x', () => 'busy' as const)).toBe('busy')
    expect(await deleteDocUnless(config, 'stageboard-b', 'plugin:x', () => null)).toBe('deleted')

    const { rev } = await putAttachment(config, 'stageboard-b', 'audio:1', 'track.mp3', undefined, 'audio/mpeg', Buffer.from([9, 8, 7]))
    expect(rev).toMatch(/^1-/)
    expect([...((await getAttachment(config, 'stageboard-b', 'audio:1', 'track.mp3')) ?? [])]).toEqual([9, 8, 7])

    const info = (await (await fetch(`${config.url}/stageboard-b`, { headers: { Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } })).json()) as { update_seq: string }
    const waiting = waitForChange(config, 'stageboard-b', String(info.update_seq), 1500)
    await putDoc(config, 'stageboard-b', { _id: 'show-state', playing: true })
    expect((await waiting).changed).toBe(true)

    await deleteDb(config, 'stageboard-b')
    expect(await listDbs(config)).not.toContain('stageboard-b')
  })
})

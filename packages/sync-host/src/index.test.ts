import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSyncHost, type SyncRequest } from './index.js'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)

let n = 0
const memory = (name: string) => new PouchDB(`${name}-${++n}`, { adapter: 'memory' })

/** A tiny web server around the host - what Fastify or the Android app do in real life. */
async function serve(handler: (r: SyncRequest) => Promise<{ status: number; body: unknown; binary?: { data: Uint8Array; contentType: string } }>): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const type = req.headers['content-type'] ?? ''
    const body = raw.length === 0 ? undefined : type.includes('json') ? JSON.parse(raw.toString('utf8')) : { data: new Uint8Array(raw), contentType: type }
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    const out = await handler({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, signal: abort.signal })
    if (out.binary) {
      res.writeHead(out.status, { 'content-type': out.binary.contentType })
      res.end(Buffer.from(out.binary.data))
      return
    }
    res.writeHead(out.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(out.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

let host: PouchDB.Database
let web: { server: Server; url: string }

beforeEach(async () => {
  host = memory('band')
  web = await serve(createSyncHost({ open: (name) => (name === 'stageboard-band' ? host : null), longpollMaxMs: 2000 }))
})

afterEach(async () => {
  await new Promise<void>((resolve) => web.server.close(() => resolve()))
})

const remote = () => new PouchDB(`${web.url}/stageboard-band`, { skip_setup: true })

describe('sync-host: CouchDB replication over a PouchDB (docs/25)', () => {
  it('a device pushes its band and a second device pulls it - documents, deletions, attachments', async () => {
    const a = memory('redmi')
    await a.put({ _id: 'song:1', title: 'TNT' })
    await a.put({ _id: 'song:2', title: 'Highway' })
    const second = await a.get('song:2')
    await a.remove(second)
    await a.putAttachment('song:1', 'cover.png', (await a.get('song:1'))._rev, Buffer.from([1, 2, 3, 4]), 'image/png')
    await a.replicate.to(remote())
    expect((await host.get('song:1')) as unknown).toMatchObject({ title: 'TNT' })

    const b = memory('fire')
    await b.replicate.from(remote())
    expect((await b.get('song:1')) as unknown).toMatchObject({ title: 'TNT' })
    await expect(b.get('song:2')).rejects.toMatchObject({ status: 404 })
    const att = (await b.getAttachment('song:1', 'cover.png')) as Buffer
    expect([...att]).toEqual([1, 2, 3, 4])
  })

  it('both edit the same document apart: the conflict reaches everyone and resolves the same way', async () => {
    const a = memory('redmi')
    const b = memory('fire')
    await a.put({ _id: 'setlist', name: 'Gig' })
    await a.replicate.to(remote())
    await b.replicate.from(remote())
    const docA = await a.get('setlist')
    const docB = await b.get('setlist')
    await a.put({ ...docA, name: 'Gig A' })
    await b.put({ ...docB, name: 'Gig B' })
    await a.replicate.to(remote())
    await b.replicate.to(remote())
    await a.replicate.from(remote())
    await b.replicate.from(remote())
    const onA = await a.get('setlist', { conflicts: true })
    const onB = await b.get('setlist', { conflicts: true })
    expect(onA._rev).toBe(onB._rev)
    expect(onA._conflicts).toHaveLength(1)
  })

  it('live sync: a change on one device reaches the other through the long-polled change feed', async () => {
    const a = memory('redmi')
    const b = memory('fire')
    const live = [a.sync(remote(), { live: true, retry: false }), b.sync(remote(), { live: true, retry: false })]
    try {
      await a.put({ _id: 'show-state', playing: true })
      await expect.poll(async () => ((await b.get('show-state').catch(() => null)) as { playing?: boolean } | null)?.playing, { timeout: 5000, interval: 50 }).toBe(true)
    } finally {
      live.forEach((s) => s.cancel())
    }
  })

  it('a second replication starts where the first stopped (checkpoints in _local)', async () => {
    const a = memory('redmi')
    await a.bulkDocs(Array.from({ length: 30 }, (_, i) => ({ _id: `doc:${i}` })))
    const first = await a.replicate.to(remote())
    expect(first.docs_written).toBe(30)
    await a.put({ _id: 'doc:new' })
    const second = await a.replicate.to(remote())
    expect(second.docs_read).toBe(1)
  })

  it('an unknown database is 404; clients may not create databases unless the host allows it', async () => {
    const res = await fetch(`${web.url}/stageboard-other`)
    expect(res.status).toBe(404)
    const put = await fetch(`${web.url}/stageboard-new`, { method: 'PUT' })
    expect(put.status).toBe(403)
  })
})

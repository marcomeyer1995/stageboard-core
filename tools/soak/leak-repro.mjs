#!/usr/bin/env node
/**
 * In-process reproduction of the 4 h soak's late slowdown (#962), unthrottled so it shows in minutes: the built-in database host
 * and three PouchDB clients that sync live and write, in ONE process, so heap and listener counts can be read directly.
 *
 *   node tools/soak/leak-repro.mjs --minutes 8 [--storage '{"auto_compaction":false,"revs_limit":50}'] [--snapshot /tmp/leak]   (run from the repo root, core-backend built)
 *
 * Prints one line per 30 s: heap MB, rss MB, write p95, requests, and what the host's own bookkeeping holds. With --snapshot it writes
 * a V8 heap snapshot after the warm-up and at the end (open both in Chrome DevTools -> Memory -> Comparison).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import v8 from 'node:v8'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)
const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > 0 ? process.argv[i + 1] : f
}
const minutes = Number(arg('minutes', '8'))
const snapshot = arg('snapshot', '')
const { startBuiltinDatabase } = await import(new URL('../../packages/core-backend/dist/builtinDatabase.js', import.meta.url))

process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e?.message); console.log(String(e?.stack).split('\n').slice(0, 4).join('\n')); process.exit(3) })
const dir = mkdtempSync(join(tmpdir(), 'sb-leak-'))
const storage = JSON.parse(arg('storage', '{"auto_compaction":true,"revs_limit":50}'))
console.log('storage options', JSON.stringify(storage))
const host = await startBuiltinDatabase({ dataDir: dir, user: 'admin', password: 'admin', port: 0, storage })
const auth = { username: 'admin', password: 'admin' }
const fetchNode = (i, o) => globalThis.fetch(i, o)
await fetch(`${host.url}/stageboard-leak`, { method: 'PUT', headers: { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}` } })

const devices = []
for (let i = 0; i < 3; i++) {
  const local = new PouchDB(`leak-${i}`, { adapter: 'memory' })
  const remote = new PouchDB(`${host.url}/stageboard-leak`, { auth, fetch: fetchNode })
  const sync = local.sync(remote, { live: true, retry: true })
  sync.on('error', () => {})
  devices.push({ local, remote, writes: 0 })
}
const lat = []
let stop = false
const writer = async (d, i) => {
  let n = 0
  while (!stop) {
    const id = `songs:${(n + i * 7) % 150}`
    const t0 = performance.now()
    try {
      const existing = await d.local.get(id).catch(() => null)
      await d.local.put({ _id: id, ...(existing ? { _rev: existing._rev } : {}), title: `t${n}`, by: i })
      d.writes++
    } catch {
      // conflicts are expected between the three writers
    }
    lat.push(performance.now() - t0)
    n++
    await new Promise((r) => setTimeout(r, 2))
  }
}
const readers = async () => {
  while (!stop) {
    await fetch(`${host.url}/stageboard-leak/_all_docs?limit=5`, { headers: { Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}` } }).then((r) => r.text()).catch(() => {})
    await new Promise((r) => setTimeout(r, 5))
  }
}
devices.forEach((d, i) => void writer(d, i))
void readers()

const p95 = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(1) : '-')
const started = Date.now()
let took = false
while (Date.now() - started < minutes * 60_000) {
  await new Promise((r) => setTimeout(r, 30_000))
  global.gc?.()
  const m = process.memoryUsage()
  const writes = devices.reduce((a, d) => a + d.writes, 0)
  console.log(`min ${((Date.now() - started) / 60000).toFixed(1)}  heap ${(m.heapUsed / 1048576).toFixed(0)} MB  rss ${(m.rss / 1048576).toFixed(0)} MB  writeP95 ${p95(lat.slice(-3000))} ms  writes ${writes}  handles ${process._getActiveHandles().length}  requests ${process._getActiveRequests().length}`)
  if (snapshot && !took && Date.now() - started > 90_000) {
    took = true
    console.log('snapshot ->', v8.writeHeapSnapshot(`${snapshot}-warm.heapsnapshot`))
  }
}
stop = true
if (snapshot) console.log('snapshot ->', v8.writeHeapSnapshot(`${snapshot}-end.heapsnapshot`))
for (const d of devices) await d.local.close().catch(() => {})
await host.close()
rmSync(dir, { recursive: true, force: true })
process.exit(0)

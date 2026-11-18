import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import HttpAdapter from 'pouchdb-adapter-http'
import ReplicationPlugin from 'pouchdb-replication'
import { afterEach, describe, expect, it } from 'vitest'
import { startBandReplication, type BandReplication } from './bandReplication.js'

PouchDB.plugin(MemoryAdapter)
PouchDB.plugin(HttpAdapter)
PouchDB.plugin(ReplicationPlugin)

let n = 0
const fresh = () => new PouchDB<Record<string, unknown>>(`repl-${Date.now()}-${n++}`, { adapter: 'memory' })
const until = async (check: () => Promise<boolean> | boolean, ms = 3_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}
let running: BandReplication | null = null
afterEach(() => running?.stop())

describe('startBandReplication (#919)', () => {
  it('copies what the primary already has, and what it gets later (live)', async () => {
    const remote = fresh()
    const local = fresh()
    await remote.put({ _id: 'profiles:a', name: 'Alex' })
    running = startBandReplication({ remote, local })
    expect(await until(async () => (await local.get('profiles:a').catch(() => null)) !== null)).toBe(true)

    await remote.put({ _id: 'songs:1', title: 'Later' })
    expect(await until(async () => (await local.get('songs:1').catch(() => null)) !== null)).toBe(true)
  })

  it('copies in one direction only: nothing written on the backup goes back to the primary', async () => {
    const remote = fresh()
    const local = fresh()
    running = startBandReplication({ remote, local })
    await local.put({ _id: 'only-here', x: 1 })
    await new Promise((r) => setTimeout(r, 300))
    expect(await remote.get('only-here').catch(() => null)).toBeNull()
  })

  it('reports where it is: caught up once the copy is current, with when the last change came in', async () => {
    const remote = fresh()
    const local = fresh()
    await remote.put({ _id: 'a' })
    running = startBandReplication({ remote, local })
    expect(await until(() => running!.status().state === 'caught-up')).toBe(true)
    expect(running.status().docsCopied).toBeGreaterThanOrEqual(1)
    expect(running.status().lastChangeAt).not.toBeNull()
  })

  it('reports `behind` when the primary cannot be reached, and does not throw', async () => {
    // A primary at a port nobody listens on (the recovery is tried with two real hosts).
    const remote = new PouchDB('http://127.0.0.1:9/stageboard-x', { adapter: 'http' })
    running = startBandReplication({ remote, local: fresh() })
    expect(await until(() => running!.status().state === 'behind', 8_000)).toBe(true)
  }, 15_000)

  it('stop() ends it: later changes are not copied', async () => {
    const remote = fresh()
    const local = fresh()
    running = startBandReplication({ remote, local })
    await new Promise((r) => setTimeout(r, 200))
    running.stop()
    await remote.put({ _id: 'after-stop' })
    await new Promise((r) => setTimeout(r, 400))
    expect(await local.get('after-stop').catch(() => null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { startCatchUp } from './catchUp.js'

function fakeLocal() {
  const emitter = new EventEmitter() as EventEmitter & { cancel: () => void; cancelled: boolean }
  emitter.cancelled = false
  emitter.cancel = () => {
    emitter.cancelled = true
  }
  const calls: unknown[] = []
  const local = { replicate: { from: (remote: unknown, options: unknown) => (calls.push({ remote, options }), emitter) } }
  return { local: local as unknown as PouchDB.Database, emitter, calls }
}

describe('the returned primary\'s copy (#947)', () => {
  it('pulls live and retrying, and follows the replication\'s own events', () => {
    const { local, emitter, calls } = fakeLocal()
    let now = 100
    const copy = startCatchUp({ remote: 'remote' as unknown as PouchDB.Database, local, now: () => now })
    expect(calls).toEqual([{ remote: 'remote', options: { live: true, retry: true } }])
    expect(copy.status()).toEqual({ state: 'starting', docsCopied: 0, lastChangeAt: null })
    emitter.emit('active')
    now = 250
    emitter.emit('change', { docs_written: 3 })
    expect(copy.status()).toEqual({ state: 'active', docsCopied: 3, lastChangeAt: 250 })
    emitter.emit('paused')
    expect(copy.status().state).toBe('caught-up')
    emitter.emit('paused', new Error('offline'))
    expect(copy.status().state).toBe('behind')
    emitter.emit('error')
    expect(copy.status().state).toBe('behind')
  })

  it('stops the replication', () => {
    const { local, emitter } = fakeLocal()
    startCatchUp({ remote: {} as PouchDB.Database, local }).stop()
    expect(emitter.cancelled).toBe(true)
  })
})

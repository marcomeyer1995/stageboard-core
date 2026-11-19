import { describe, expect, it, vi } from 'vitest'
import { createHostPresence } from './presence.js'

function store(startAt = 1_000) {
  let t = startAt
  return { p: createHostPresence({ now: () => t, newId: (() => { let n = 0; return () => `flash-${++n}` })() }), advance: (ms: number) => (t += ms) }
}

describe('snapshot', () => {
  it('is empty for a band nothing has reported into yet', () => {
    expect(store().p.snapshot('band-a')).toEqual({ devices: {} })
  })

  it('reflects every device entry of that band, stamped with the host\'s own time', () => {
    const { p, advance } = store(100)
    p.setEntry('band-a', 'device-1', 'p1')
    advance(100)
    p.setEntry('band-a', 'device-2', 'p2')
    expect(p.snapshot('band-a')).toEqual({ devices: { 'device-1': { profileId: 'p1', lastSeenAt: 100 }, 'device-2': { profileId: 'p2', lastSeenAt: 200 } } })
  })

  it('keeps two devices reporting the same profile as separate entries (multi-device presence)', () => {
    const { p } = store()
    p.setEntry('band-a', 'device-1', 'p1')
    p.setEntry('band-a', 'device-2', 'p1')
    expect(Object.keys(p.snapshot('band-a').devices)).toHaveLength(2)
  })

  it('keeps bands fully isolated from each other', () => {
    const { p } = store()
    p.setEntry('band-a', 'device-1', 'p1')
    p.setMasterHeartbeat('band-a', 'device-1')
    expect(p.snapshot('band-b')).toEqual({ devices: {} })
  })

  it('overwrites an existing entry for the same device', () => {
    const { p, advance } = store(100)
    p.setEntry('band-a', 'device-1', 'p1')
    advance(100)
    p.setEntry('band-a', 'device-1', 'p1')
    expect(p.snapshot('band-a').devices['device-1']).toEqual({ profileId: 'p1', lastSeenAt: 200 })
  })
})

describe('subscribe', () => {
  it('calls the subscriber at once with the current snapshot, and again with the full snapshot on every later change', () => {
    const { p } = store()
    p.setEntry('band-a', 'device-1', 'p1')
    const seen = vi.fn()
    p.subscribe('band-a', seen)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith({ devices: { 'device-1': { profileId: 'p1', lastSeenAt: 1_000 } } })
    p.setEntry('band-a', 'device-2', 'p2')
    expect(seen).toHaveBeenCalledTimes(2)
    expect(Object.keys(seen.mock.calls[1]![0].devices)).toEqual(['device-1', 'device-2'])
  })

  it('does not notify a subscriber of another band, and stops once unsubscribed', () => {
    const { p } = store()
    const seen = vi.fn()
    const leave = p.subscribe('band-a', seen)
    seen.mockClear()
    p.setEntry('band-b', 'x', 'p')
    expect(seen).not.toHaveBeenCalled()
    leave()
    p.setEntry('band-a', 'x', 'p')
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('the master\'s heartbeat', () => {
  it('is stamped with the host\'s time and exposed on the snapshot', () => {
    const { p } = store(5_000)
    p.setMasterHeartbeat('band-a', 'device-1')
    expect(p.snapshot('band-a').masterHeartbeat).toEqual({ deviceId: 'device-1', at: 5_000 })
    expect(p.snapshot('band-b').masterHeartbeat).toBeUndefined()
  })

  it('keeps only the latest master and notifies each time', () => {
    const { p } = store()
    const seen = vi.fn()
    p.subscribe('band-a', seen)
    seen.mockClear()
    p.setMasterHeartbeat('band-a', 'device-1')
    p.setMasterHeartbeat('band-a', 'device-2')
    expect(seen).toHaveBeenCalledTimes(2)
    expect(p.snapshot('band-a').masterHeartbeat?.deviceId).toBe('device-2')
  })
})

describe('the Ready Check', () => {
  it('collects each profile once for the open check', () => {
    const { p } = store()
    p.setReady('band-a', 'c1', 'anna')
    p.setReady('band-a', 'c1', 'ben')
    p.setReady('band-a', 'c1', 'anna')
    expect(p.snapshot('band-a').readyCheck).toEqual({ checkId: 'c1', readyProfileIds: ['anna', 'ben'] })
    expect(p.snapshot('band-b').readyCheck).toBeUndefined()
  })

  it('starts fresh for a new check id, so old answers never count', () => {
    const { p } = store()
    p.setReady('band-a', 'c1', 'anna')
    p.setReady('band-a', 'c2', 'ben')
    expect(p.snapshot('band-a').readyCheck).toEqual({ checkId: 'c2', readyProfileIds: ['ben'] })
  })

  it('notifies subscribers with the full snapshot', () => {
    const { p } = store()
    const seen = vi.fn()
    p.subscribe('band-a', seen)
    seen.mockClear()
    p.setReady('band-a', 'c1', 'anna')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0].readyCheck.readyProfileIds).toEqual(['anna'])
  })
})

describe('the Stage-Messenger flash message', () => {
  it('is the latest message of the band, with an id, a time and who it is for', () => {
    const { p } = store(7_000)
    const flash = p.setFlash('band-a', 'Pause 10 min', 'Anna', ['p1', 'p2'])
    expect(flash).toEqual({ id: 'flash-1', text: 'Pause 10 min', from: 'Anna', to: ['p1', 'p2'], at: 7_000 })
    expect(p.snapshot('band-a').flash).toEqual(flash)
    expect(p.snapshot('band-b').flash).toBeUndefined()
  })

  it('goes to everyone when it names nobody, and replaces the one before', () => {
    const { p } = store()
    p.setFlash('band-a', 'one', undefined)
    const second = p.setFlash('band-a', 'two', undefined, [])
    expect(second).not.toHaveProperty('to')
    expect(p.snapshot('band-a').flash?.text).toBe('two')
  })

  it('reaches every subscriber of the band at once', () => {
    const { p } = store()
    const seen = vi.fn()
    p.subscribe('band-a', seen)
    seen.mockClear()
    p.setFlash('band-a', 'hi', 'x')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0].flash.text).toBe('hi')
  })
})

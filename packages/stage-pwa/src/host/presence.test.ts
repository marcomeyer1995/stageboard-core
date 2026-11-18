import { describe, expect, it, vi } from 'vitest'
import { createHostPresence } from './presence'

describe('presence on the tablet host (#947)', () => {
  it('starts empty and stamps the master\'s beat with its own (band) time', () => {
    let now = 1_000
    const presence = createHostPresence({ now: () => now })
    expect(presence.snapshot()).toEqual({ devices: {} })
    expect(presence.heartbeat({ deviceId: 'fire' })).toBe(true)
    now = 6_000
    expect(presence.heartbeat({ deviceId: 'fire' })).toBe(true)
    expect(presence.snapshot().masterHeartbeat).toEqual({ deviceId: 'fire', at: 6_000 })
  })

  it('keeps every device\'s last report', () => {
    const presence = createHostPresence({ now: () => 42 })
    presence.report({ deviceId: 'a', profileId: 'p1' })
    presence.report({ deviceId: 'b', profileId: 'p2' })
    expect(presence.snapshot().devices).toEqual({ a: { profileId: 'p1', lastSeenAt: 42 }, b: { profileId: 'p2', lastSeenAt: 42 } })
  })

  it('takes no body that is not a report or a beat', () => {
    const presence = createHostPresence({ now: () => 1 })
    expect(presence.report({ deviceId: 'a' })).toBe(false)
    expect(presence.report(null)).toBe(false)
    expect(presence.heartbeat({})).toBe(false)
    expect(presence.snapshot()).toEqual({ devices: {} })
  })

  it('hands a new subscriber the snapshot at once and every change after, until it leaves', () => {
    const presence = createHostPresence({ now: () => 1 })
    presence.heartbeat({ deviceId: 'fire' })
    const seen = vi.fn()
    const leave = presence.subscribe(seen)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0].masterHeartbeat?.deviceId).toBe('fire')
    presence.report({ deviceId: 'a', profileId: 'p' })
    expect(seen).toHaveBeenCalledTimes(2)
    leave()
    presence.report({ deviceId: 'b', profileId: 'p' })
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

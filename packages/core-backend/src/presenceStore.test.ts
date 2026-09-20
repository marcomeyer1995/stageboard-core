import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetPresenceStoreForTests, getSnapshot, setEntry, setMasterHeartbeat, setReady, subscribe } from './presenceStore.js'

beforeEach(() => {
  __resetPresenceStoreForTests()
})

describe('getSnapshot', () => {
  it('is empty for a workspace nothing has reported into yet', () => {
    expect(getSnapshot('band-a')).toEqual({ devices: {} })
  })

  it('reflects every device entry set for that workspace', () => {
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })
    setEntry('band-a', 'device-2', { profileId: 'p2', lastSeenAt: 200 })

    expect(getSnapshot('band-a')).toEqual({
      devices: {
        'device-1': { profileId: 'p1', lastSeenAt: 100 },
        'device-2': { profileId: 'p2', lastSeenAt: 200 },
      },
    })
  })

  it('keeps two devices reporting the same profileId as separate entries (multi-device presence)', () => {
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })
    setEntry('band-a', 'device-2', { profileId: 'p1', lastSeenAt: 200 })

    expect(Object.keys(getSnapshot('band-a').devices)).toHaveLength(2)
  })

  it('keeps workspaces fully isolated from each other', () => {
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })
    expect(getSnapshot('band-b')).toEqual({ devices: {} })
  })

  it('overwrites an existing entry for the same device', () => {
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 200 })

    expect(getSnapshot('band-a').devices['device-1']).toEqual({ profileId: 'p1', lastSeenAt: 200 })
  })
})

describe('subscribe', () => {
  it('calls the subscriber immediately with the current snapshot', () => {
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })
    const subscriber = vi.fn()

    subscribe('band-a', subscriber)

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith({ devices: { 'device-1': { profileId: 'p1', lastSeenAt: 100 } } })
  })

  it('calls every subscriber again with the full snapshot on a later update', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith({ devices: { 'device-1': { profileId: 'p1', lastSeenAt: 100 } } })
  })

  it('does not notify a subscriber of a different workspace', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setEntry('band-b', 'device-1', { profileId: 'p1', lastSeenAt: 100 })

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('stops notifying once unsubscribed', () => {
    const subscriber = vi.fn()
    const unsubscribe = subscribe('band-a', subscriber)
    subscriber.mockClear()

    unsubscribe()
    setEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 100 })

    expect(subscriber).not.toHaveBeenCalled()
  })
})

describe('setMasterHeartbeat', () => {
  it('stamps the beat with server time and exposes it on the snapshot', () => {
    const before = Date.now()
    setMasterHeartbeat('band-a', 'device-1')

    const beat = getSnapshot('band-a').masterHeartbeat
    expect(beat?.deviceId).toBe('device-1')
    expect(beat?.at).toBeGreaterThanOrEqual(before)
    expect(getSnapshot('band-b').masterHeartbeat).toBeUndefined()
  })

  it('keeps only the latest master and notifies subscribers', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setMasterHeartbeat('band-a', 'device-1')
    setMasterHeartbeat('band-a', 'device-2')

    expect(subscriber).toHaveBeenCalledTimes(2)
    expect(getSnapshot('band-a').masterHeartbeat?.deviceId).toBe('device-2')
  })
})

describe('setReady', () => {
  it('collects each profile once for the open check', () => {
    setReady('band-a', 'c1', 'anna')
    setReady('band-a', 'c1', 'ben')
    setReady('band-a', 'c1', 'anna')

    expect(getSnapshot('band-a').readyCheck).toEqual({ checkId: 'c1', readyProfileIds: ['anna', 'ben'] })
    expect(getSnapshot('band-b').readyCheck).toBeUndefined()
  })

  it('starts fresh for a new check id, so old answers never count', () => {
    setReady('band-a', 'c1', 'anna')
    setReady('band-a', 'c2', 'ben')

    expect(getSnapshot('band-a').readyCheck).toEqual({ checkId: 'c2', readyProfileIds: ['ben'] })
  })

  it('notifies subscribers with the full snapshot', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setReady('band-a', 'c1', 'anna')

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber.mock.calls[0][0].readyCheck.readyProfileIds).toEqual(['anna'])
  })
})

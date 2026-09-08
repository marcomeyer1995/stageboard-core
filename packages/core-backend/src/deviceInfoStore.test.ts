import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDeviceInfoStoreForTests, allEntries, getSnapshot, patchEntry, setEntry, subscribe } from './deviceInfoStore.js'

const ENTRY = {
  ip: '192.168.1.10',
  os: 'iPad',
  environment: 'browser' as const,
  syncStatus: 'idle' as const,
  lastSeenAt: 100,
  networkReachable: null,
  hostname: null,
}

beforeEach(() => {
  __resetDeviceInfoStoreForTests()
})

describe('getSnapshot', () => {
  it('is empty for a workspace nothing has reported into yet', () => {
    expect(getSnapshot('band-a')).toEqual({ devices: {} })
  })

  it('reflects every device entry set for that workspace', () => {
    setEntry('band-a', 'device-1', ENTRY)
    expect(getSnapshot('band-a')).toEqual({ devices: { 'device-1': ENTRY } })
  })

  it('keeps workspaces fully isolated from each other', () => {
    setEntry('band-a', 'device-1', ENTRY)
    expect(getSnapshot('band-b')).toEqual({ devices: {} })
  })

  it('overwrites an existing entry for the same device', () => {
    setEntry('band-a', 'device-1', ENTRY)
    setEntry('band-a', 'device-1', { ...ENTRY, lastSeenAt: 200 })
    expect(getSnapshot('band-a').devices['device-1']).toEqual({ ...ENTRY, lastSeenAt: 200 })
  })
})

describe('patchEntry', () => {
  it('merges a partial update onto an existing entry', () => {
    setEntry('band-a', 'device-1', ENTRY)
    patchEntry('band-a', 'device-1', { networkReachable: true, hostname: 'ipad.local' })
    expect(getSnapshot('band-a').devices['device-1']).toEqual({ ...ENTRY, networkReachable: true, hostname: 'ipad.local' })
  })

  it('is a no-op when the device has no entry yet', () => {
    patchEntry('band-a', 'device-1', { networkReachable: true })
    expect(getSnapshot('band-a')).toEqual({ devices: {} })
  })

  it('notifies subscribers of the merged result', () => {
    setEntry('band-a', 'device-1', ENTRY)
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    patchEntry('band-a', 'device-1', { networkReachable: false })

    expect(subscriber).toHaveBeenCalledWith({ devices: { 'device-1': { ...ENTRY, networkReachable: false } } })
  })
})

describe('allEntries', () => {
  it('lists every (workspaceId, deviceId, ip) across all workspaces', () => {
    setEntry('band-a', 'device-1', ENTRY)
    setEntry('band-b', 'device-2', { ...ENTRY, ip: '10.0.0.5' })

    expect(allEntries()).toEqual(
      expect.arrayContaining([
        { workspaceId: 'band-a', deviceId: 'device-1', ip: '192.168.1.10' },
        { workspaceId: 'band-b', deviceId: 'device-2', ip: '10.0.0.5' },
      ]),
    )
  })

  it('is empty when nothing has reported', () => {
    expect(allEntries()).toEqual([])
  })
})

describe('subscribe', () => {
  it('calls the subscriber immediately with the current snapshot', () => {
    setEntry('band-a', 'device-1', ENTRY)
    const subscriber = vi.fn()

    subscribe('band-a', subscriber)

    expect(subscriber).toHaveBeenCalledOnce()
    expect(subscriber).toHaveBeenCalledWith({ devices: { 'device-1': ENTRY } })
  })

  it('does not notify a subscriber of a different workspace', () => {
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    setEntry('band-b', 'device-1', ENTRY)

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('stops notifying once unsubscribed', () => {
    const subscriber = vi.fn()
    const unsubscribe = subscribe('band-a', subscriber)
    subscriber.mockClear()

    unsubscribe()
    setEntry('band-a', 'device-1', ENTRY)

    expect(subscriber).not.toHaveBeenCalled()
  })
})

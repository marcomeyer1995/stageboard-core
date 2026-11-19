import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHostDeviceInfo, type HostDeviceInfo } from './deviceInfo.js'

let store: HostDeviceInfo
let t = 5_000
const getSnapshot = (ws: string) => store.snapshot(ws)
const setEntry: HostDeviceInfo['setEntry'] = (...a) => store.setEntry(...a)
const patchEntry: HostDeviceInfo['patchEntry'] = (...a) => store.patchEntry(...a)
const subscribe: HostDeviceInfo['subscribe'] = (...a) => store.subscribe(...a)
const allEntries = () => store.allEntries()

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
  t = 5_000
  store = createHostDeviceInfo({ now: () => t })
})

describe('getSnapshot', () => {
  it('is empty for a workspace nothing has reported into yet', () => {
    expect(getSnapshot('band-a')).toEqual({ devices: {}, collectingSince: 5_000 })
  })

  it('reflects every device entry set for that workspace', () => {
    setEntry('band-a', 'device-1', ENTRY)
    expect(getSnapshot('band-a')).toEqual({ devices: { 'device-1': ENTRY }, collectingSince: 5_000 })
  })

  it('keeps workspaces fully isolated from each other', () => {
    setEntry('band-a', 'device-1', ENTRY)
    expect(getSnapshot('band-b')).toEqual({ devices: {}, collectingSince: 5_000 })
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
    expect(getSnapshot('band-a')).toEqual({ devices: {}, collectingSince: 5_000 })
  })

  it('notifies subscribers of the merged result', () => {
    setEntry('band-a', 'device-1', ENTRY)
    const subscriber = vi.fn()
    subscribe('band-a', subscriber)
    subscriber.mockClear()

    patchEntry('band-a', 'device-1', { networkReachable: false })

    expect(subscriber).toHaveBeenCalledWith({ devices: { 'device-1': { ...ENTRY, networkReachable: false } }, collectingSince: 5_000 })
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
    expect(subscriber).toHaveBeenCalledWith({ devices: { 'device-1': ENTRY }, collectingSince: 5_000 })
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

describe('collectingSince', () => {
  it('is when this host started collecting - until every device has had time to report, a missing report says nothing', () => {
    t = 9_999
    expect(store.snapshot('band-a').collectingSince).toBe(5_000)
  })
})

describe('report (what a device sends every few seconds)', () => {
  const REPORT = { deviceId: 'device-1', os: 'iPad', environment: 'browser' as const, syncStatus: 'idle' as const }

  it('makes the entry: the host stamps the sender\'s address and the time, the device says the rest', () => {
    t = 7_000
    store.report('band-a', REPORT, '192.168.1.10')
    expect(store.snapshot('band-a').devices['device-1']).toEqual({ ip: '192.168.1.10', os: 'iPad', environment: 'browser', syncStatus: 'idle', lastSeenAt: 7_000, networkReachable: null, hostname: null, audioOutput: null, vitals: null, leadNeededMs: null, battery: null, midiOutputs: null, silenced: null, foreground: null })
  })

  it('keeps what the background ping found (reachable, hostname) across a new report - the device does not know either', () => {
    store.report('band-a', REPORT, '10.0.0.5')
    store.patchEntry('band-a', 'device-1', { networkReachable: true, hostname: 'ipad.local' })
    store.report('band-a', { ...REPORT, syncStatus: 'syncing' }, '10.0.0.5')
    expect(store.snapshot('band-a').devices['device-1']).toMatchObject({ syncStatus: 'syncing', networkReachable: true, hostname: 'ipad.local' })
  })

  it('passes the optional fields through', () => {
    store.report('band-a', { ...REPORT, midiOutputs: ['Port 1'], foreground: true, leadNeededMs: 600 }, '10.0.0.5')
    expect(store.snapshot('band-a').devices['device-1']).toMatchObject({ midiOutputs: ['Port 1'], foreground: true, leadNeededMs: 600 })
  })

  it('uses a placeholder address when the platform cannot tell the sender\'s, rather than losing the report', () => {
    store.report('band-a', REPORT, undefined)
    expect(store.snapshot('band-a').devices['device-1']!.ip).toBe('unknown')
  })
})

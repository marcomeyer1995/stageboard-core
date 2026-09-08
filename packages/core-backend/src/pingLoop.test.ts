import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

const reverseMock = vi.fn()
vi.mock('node:dns', () => ({
  promises: { reverse: (...args: unknown[]) => reverseMock(...args) },
}))

const { tick } = await import('./pingLoop.js')
const { __resetDeviceInfoStoreForTests, getSnapshot, setEntry } = await import('./deviceInfoStore.js')

const BASE_ENTRY = {
  ip: '192.168.1.10',
  os: 'iPad',
  environment: 'browser' as const,
  syncStatus: 'idle' as const,
  lastSeenAt: 100,
  networkReachable: null,
  hostname: null,
}

/** execFile's promisified interface calls back node-style: `(err, {stdout, stderr})`. */
function succeedsPing() {
  execFileMock.mockImplementation((_cmd, _args, callback) => callback(null, { stdout: '', stderr: '' }))
}
function failsPing() {
  execFileMock.mockImplementation((_cmd, _args, callback) => callback(new Error('ping: unreachable')))
}

beforeEach(() => {
  __resetDeviceInfoStoreForTests()
  execFileMock.mockReset()
  reverseMock.mockReset()
})

describe('tick', () => {
  it('marks a device reachable when the system ping succeeds', async () => {
    setEntry('band-a', 'device-1', BASE_ENTRY)
    succeedsPing()
    reverseMock.mockRejectedValue(new Error('ENOTFOUND'))

    await tick()

    expect(getSnapshot('band-a').devices['device-1'].networkReachable).toBe(true)
  })

  it('marks a device unreachable when the system ping fails', async () => {
    setEntry('band-a', 'device-1', BASE_ENTRY)
    failsPing()
    reverseMock.mockRejectedValue(new Error('ENOTFOUND'))

    await tick()

    expect(getSnapshot('band-a').devices['device-1'].networkReachable).toBe(false)
  })

  it('sets hostname from a successful reverse-DNS lookup', async () => {
    setEntry('band-a', 'device-1', BASE_ENTRY)
    succeedsPing()
    reverseMock.mockResolvedValue(['ipad.local'])

    await tick()

    expect(getSnapshot('band-a').devices['device-1'].hostname).toBe('ipad.local')
  })

  it('leaves hostname null when reverse-DNS fails, without erroring', async () => {
    setEntry('band-a', 'device-1', BASE_ENTRY)
    succeedsPing()
    reverseMock.mockRejectedValue(new Error('ENOTFOUND'))

    await expect(tick()).resolves.toBeUndefined()
    expect(getSnapshot('band-a').devices['device-1'].hostname).toBeNull()
  })

  it('pings every known device across every workspace', async () => {
    setEntry('band-a', 'device-1', BASE_ENTRY)
    setEntry('band-b', 'device-2', { ...BASE_ENTRY, ip: '10.0.0.5' })
    succeedsPing()
    reverseMock.mockRejectedValue(new Error('ENOTFOUND'))

    await tick()

    expect(execFileMock).toHaveBeenCalledTimes(2)
    expect(getSnapshot('band-a').devices['device-1'].networkReachable).toBe(true)
    expect(getSnapshot('band-b').devices['device-2'].networkReachable).toBe(true)
  })

  it('does nothing when no device is known yet', async () => {
    await expect(tick()).resolves.toBeUndefined()
    expect(execFileMock).not.toHaveBeenCalled()
  })
})

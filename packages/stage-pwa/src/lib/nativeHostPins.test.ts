import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'

// The native app: both shell plugins are mocks, Capacitor reports a native platform.
const plugins = vi.hoisted(() => ({
  trust: { pin: vi.fn<(o: { host: string; fingerprint: string }) => Promise<void>>(async () => {}), pinned: vi.fn<(o: { host: string }) => Promise<{ fingerprint: string | null }>>(async () => ({ fingerprint: null })), fingerprintOf: vi.fn(), downloadAndInstall: vi.fn() },
  discovery: { discover: vi.fn(async () => ({ servers: [] })) },
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: (name: string) => (name === 'HostDiscovery' ? plugins.discovery : plugins.trust),
}))

const { hostsToPin, pinListedHosts, hostOfUrl } = await import('./native')

const FP1 = 'a'.repeat(64)
const FP2 = 'b'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: FP1, priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2', certFingerprint: FP2, priority: 2 }

beforeEach(() => {
  plugins.trust.pin.mockClear()
  plugins.trust.pinned.mockReset()
  plugins.trust.pinned.mockResolvedValue({ fingerprint: null })
})
afterEach(() => vi.clearAllMocks())

describe('hostOfUrl (#916, native)', () => {
  it('is the address the app stores and pins: host, with the port only when it is not 443', () => {
    expect(hostOfUrl('https://10.0.0.1:8443')).toBe('10.0.0.1:8443')
    expect(hostOfUrl('https://10.0.0.2')).toBe('10.0.0.2')
    expect(hostOfUrl('https://10.0.0.2:443/')).toBe('10.0.0.2')
  })
})

describe('hostsToPin (#916, native)', () => {
  it('pins a listed host that has a fingerprint and is not pinned yet', () => {
    expect(hostsToPin([primary, backup], {})).toEqual({ pin: [{ host: '10.0.0.1:8443', fingerprint: FP1 }, { host: '10.0.0.2', fingerprint: FP2 }], conflicts: [] })
  })

  it('leaves what is already pinned to the same fingerprint alone', () => {
    expect(hostsToPin([primary], { '10.0.0.1:8443': FP1 }).pin).toEqual([])
  })

  it('never overwrites a different pin: a changed certificate is reported, not trusted', () => {
    const result = hostsToPin([primary], { '10.0.0.1:8443': FP2 })
    expect(result.pin).toEqual([])
    expect(result.conflicts).toEqual(['10.0.0.1:8443'])
  })

  it('skips a host without a fingerprint - nothing to pin', () => {
    expect(hostsToPin([{ ...primary, certFingerprint: undefined }], {})).toEqual({ pin: [], conflicts: [] })
  })
})

describe('pinListedHosts (#916, native)', () => {
  it('asks the shell what is pinned and pins the rest', async () => {
    plugins.trust.pinned.mockImplementation(async ({ host }) => ({ fingerprint: host === '10.0.0.1:8443' ? FP1 : null }))
    const result = await pinListedHosts([primary, backup])
    expect(plugins.trust.pin).toHaveBeenCalledTimes(1)
    expect(plugins.trust.pin).toHaveBeenCalledWith({ host: '10.0.0.2', fingerprint: FP2 })
    expect(result.conflicts).toEqual([])
  })

  it('does not pin on a conflict, and does not throw when the shell fails', async () => {
    plugins.trust.pinned.mockResolvedValue({ fingerprint: FP2 })
    expect((await pinListedHosts([primary])).conflicts).toEqual(['10.0.0.1:8443'])
    expect(plugins.trust.pin).not.toHaveBeenCalled()
    plugins.trust.pinned.mockRejectedValue(new Error('shell down'))
    await expect(pinListedHosts([primary])).resolves.toEqual({ pin: [], conflicts: [] })
  })
})

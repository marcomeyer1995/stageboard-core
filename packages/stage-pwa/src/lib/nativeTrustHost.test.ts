import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugins = vi.hoisted(() => ({
  trust: {
    pin: vi.fn<(o: { host: string; fingerprint: string }) => Promise<void>>(async () => {}),
    pinned: vi.fn<(o: { host: string }) => Promise<{ fingerprint: string | null }>>(async () => ({ fingerprint: null })),
    fingerprintOf: vi.fn<(o: { host: string }) => Promise<{ fingerprint: string }>>(async () => ({ fingerprint: 'c'.repeat(64) })),
  },
  discovery: { discover: vi.fn(async () => ({ servers: [] })) },
}))
let native = true
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
  registerPlugin: (name: string) => (name === 'HostDiscovery' ? plugins.discovery : plugins.trust),
}))

const { trustHostFor } = await import('./native')

beforeEach(() => {
  native = true
  plugins.trust.pin.mockClear()
  plugins.trust.pinned.mockReset().mockResolvedValue({ fingerprint: null })
  plugins.trust.fingerprintOf.mockReset().mockResolvedValue({ fingerprint: 'c'.repeat(64) })
})

describe('trustHostFor (#964, the "Verbinden" of a local band)', () => {
  it('asks once with the certificate the host presents, and pins it when confirmed - the address may carry a scheme and a path', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    expect(await trustHostFor('https://192.168.178.158:8451/', confirm)).toBe('trusted')
    expect(plugins.trust.fingerprintOf).toHaveBeenCalledWith({ host: '192.168.178.158:8451' })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(plugins.trust.pin).toHaveBeenCalledWith({ host: '192.168.178.158:8451', fingerprint: 'c'.repeat(64) })
  })

  it('does not ask again for a host whose pinned certificate is the one it presents', async () => {
    plugins.trust.pinned.mockResolvedValue({ fingerprint: 'c'.repeat(64) })
    const confirm = vi.fn()
    expect(await trustHostFor('10.0.0.1:8443', confirm)).toBe('trusted')
    expect(confirm).not.toHaveBeenCalled()
    expect(plugins.trust.pin).not.toHaveBeenCalled()
  })

  it('asks again when the host presents another certificate than the pinned one - never trusts it silently', async () => {
    plugins.trust.pinned.mockResolvedValue({ fingerprint: 'd'.repeat(64) })
    const confirm = vi.fn().mockResolvedValue(false)
    expect(await trustHostFor('10.0.0.1:8443', confirm)).toBe('declined')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(plugins.trust.pin).not.toHaveBeenCalled()
  })

  it('says unreachable when the host presents nothing, and has nothing to do in a browser', async () => {
    plugins.trust.fingerprintOf.mockRejectedValue(new Error('no route'))
    expect(await trustHostFor('10.0.0.9', vi.fn())).toBe('unreachable')
    native = false
    const confirm = vi.fn()
    expect(await trustHostFor('10.0.0.1', confirm)).toBe('trusted')
    expect(confirm).not.toHaveBeenCalled()
  })
})

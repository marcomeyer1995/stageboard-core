import { describe, expect, it, vi } from 'vitest'
import { lookUpHost } from './hostLookup.js'

const FP = 'c'.repeat(64)

/** A fake host: `/time` and `/server-info` answers by path, null for everything else. */
function stubHost(answers: Record<string, unknown | null>) {
  return vi.fn(async (url: string) => answers[new URL(url).pathname] ?? null)
}

describe('lookUpHost (#914, #945)', () => {
  it('reads the host id from /time and the fingerprint from /server-info', async () => {
    const get = stubHost({ '/time': { serverTime: 1, hostId: 'stage-pc', epoch: 1 }, '/server-info': { certFingerprint: FP } })
    expect(await lookUpHost('https://10.0.0.2:8443', get)).toEqual({ hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: FP })
    // It asks the host the admin named, not some discovery result.
    expect(get.mock.calls.map((call) => call[0])).toEqual(['https://10.0.0.2:8443/time', 'https://10.0.0.2:8443/server-info'])
  })

  it('leaves the fingerprint out when the host has none (no pinning)', async () => {
    const get = stubHost({ '/time': { serverTime: 1, hostId: 'stage-pc', epoch: 1 }, '/server-info': { certFingerprint: null } })
    expect(await lookUpHost('https://10.0.0.2', get)).toEqual({ hostId: 'stage-pc', url: 'https://10.0.0.2' })
  })

  it('is null for a host that does not answer, or one built before host ids existed', async () => {
    expect(await lookUpHost('https://10.0.0.2', stubHost({}))).toBeNull()
    const old = stubHost({ '/time': { serverTime: 1 }, '/server-info': { certFingerprint: FP } })
    expect(await lookUpHost('https://10.0.0.2', old)).toBeNull()
  })

  it('is null for a fingerprint in a form the band list would reject, instead of storing it', async () => {
    const get = stubHost({ '/time': { serverTime: 1, hostId: 'stage-pc', epoch: 1 }, '/server-info': { certFingerprint: 'AA:BB' } })
    expect(await lookUpHost('https://10.0.0.2', get)).toBeNull()
  })

  it('takes the address without a trailing slash, and never checks a fingerprint of its own', async () => {
    const get = stubHost({ '/time': { serverTime: 1, hostId: 'stage-pc', epoch: 1 }, '/server-info': { certFingerprint: FP } })
    expect(await lookUpHost('https://10.0.0.2:8443/', get)).toMatchObject({ url: 'https://10.0.0.2:8443' })
  })
})

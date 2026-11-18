import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { createHostLeaseService, fingerprintMatches } from './hostLeaseService.js'
import { leaseKey, signLease, verifyLease } from './hostLeaseAuth.js'

const FP1 = 'a'.repeat(64)
const FP2 = 'b'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: FP1, priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', certFingerprint: FP2, priority: 2 }
const KEY = leaseKey('12345678', 'band-a')

function service(self: string, hosts: BandHostEntry[] | null, over: Partial<Parameters<typeof createHostLeaseService>[0]> = {}) {
  let t = 10_000
  const post = vi.fn().mockResolvedValue(true)
  // The primary's clock runs 250 ms ahead of ours; an answer takes 4 ms.
  const get = vi.fn(async () => {
    t += 2
    const serverTime = t + 250
    t += 2
    return { serverTime, hostId: 'laptop', epoch: 1 }
  })
  const s = createHostLeaseService({
    selfHostId: self,
    epoch: () => 1,
    workspaceId: () => 'band-a',
    readHosts: async () => hosts,
    readAccessCode: async () => '12345678',
    post,
    get,
    now: () => t,
    ...over,
  })
  return { s, post, get, advance: (ms: number) => (t += ms) }
}

describe('host lease service (#918)', () => {
  it('the primary signs a lease and posts it to the backup, pinned to the listed fingerprint', async () => {
    const { s, post } = service('laptop', [primary, backup])
    await s.sendOnce()
    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, fingerprint] = post.mock.calls[0]!
    expect(url).toBe('https://10.0.0.2:8443/host/lease')
    expect(fingerprint).toBe(FP2)
    expect(verifyLease(body, KEY)).toMatchObject({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 10_000 })
  })

  it('sentAt rises with every lease', async () => {
    const { s, post, advance } = service('laptop', [primary, backup])
    await s.sendOnce()
    advance(1_000)
    await s.sendOnce()
    const sent = post.mock.calls.map((c) => verifyLease(c[1], KEY)!.sentAt)
    expect(sent[1]).toBeGreaterThan(sent[0]!)
  })

  it('sends nothing as the backup, without two hosts, without a band, or when not listed', async () => {
    for (const { s, post } of [
      service('stage-pc', [primary, backup]),
      service('laptop', [primary]),
      service('laptop', null),
      service('laptop', [primary, backup], { workspaceId: () => null }),
      service('stranger', [primary, backup]),
    ]) {
      await s.sendOnce()
      expect(post).not.toHaveBeenCalled()
    }
  })

  it('the backup samples the primary\'s clock, pinned to the listed fingerprint, and learns its offset', async () => {
    const { s, get } = service('stage-pc', [primary, backup])
    expect(s.clockOffsetMs()).toBeNull()
    await s.sampleOnce()
    expect(get).toHaveBeenCalledWith('https://10.0.0.1:8443/time', FP1)
    expect(s.clockOffsetMs()).toBeCloseTo(250, 5)
  })

  it('only the backup samples: not the primary, not without two hosts or a band', async () => {
    for (const { s, get } of [
      service('laptop', [primary, backup]),
      service('stage-pc', [backup]),
      service('stage-pc', null),
      service('stage-pc', [primary, backup], { workspaceId: () => null }),
    ]) {
      await s.sampleOnce()
      expect(get).not.toHaveBeenCalled()
    }
  })

  it('a sample that fails, or answers without a time, changes nothing and does not throw', async () => {
    const { s } = service('stage-pc', [primary, backup], { get: vi.fn().mockRejectedValue(new Error('down')) })
    await expect(s.sampleOnce()).resolves.toBeUndefined()
    const none = service('stage-pc', [primary, backup], { get: vi.fn().mockResolvedValue({ nonsense: true }) })
    await none.s.sampleOnce()
    expect(none.s.clockOffsetMs()).toBeNull()
  })

  it('a failing post does not throw', async () => {
    const { s } = service('laptop', [primary, backup], { post: vi.fn().mockRejectedValue(new Error('down')) })
    await expect(s.sendOnce()).resolves.toBeUndefined()
  })

  it('the backup accepts a signed lease from the primary and reports it alive', async () => {
    const { s } = service('stage-pc', [primary, backup])
    const body = signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY)
    expect(await s.receive(body)).toBe('accepted')
    expect(s.status()).toMatchObject({ hostId: 'laptop', epoch: 1, alive: true })
  })

  it('the backup refuses a lease signed with another code', async () => {
    const { s } = service('stage-pc', [primary, backup])
    const body = signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, leaseKey('00000000', 'band-a'))
    expect(await s.receive(body)).toBe('ignored')
    expect(s.status()).toBeNull()
  })

  it('refuses everything when it serves no band', async () => {
    const { s } = service('stage-pc', [primary, backup], { workspaceId: () => null })
    expect(await s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))).toBe('ignored')
  })
})

describe('fingerprintMatches (#918)', () => {
  it('compares the certificate fingerprint in the band list form (lowercase hex, no colons)', () => {
    expect(fingerprintMatches('AA:BB:CC', 'aabbcc')).toBe(true)
    expect(fingerprintMatches('AA:BB:CC', 'aabbcd')).toBe(false)
  })

  it('without a listed fingerprint nothing can be pinned, so it does not match', () => {
    expect(fingerprintMatches('AA:BB', undefined)).toBe(false)
  })
})

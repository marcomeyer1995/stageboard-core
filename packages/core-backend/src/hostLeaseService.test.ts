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
  let saved = { epoch: 0, active: false }
  const store = { load: () => saved, save: (r: { epoch: number; active: boolean }) => void (saved = r) }
  const post = vi.fn().mockResolvedValue({ accepted: true, epoch: 1, active: false })
  // The primary's clock runs 250 ms ahead of ours; an answer takes 4 ms.
  const get = vi.fn(async (): Promise<unknown> => {
    t += 2
    const serverTime = t + 250
    t += 2
    return { serverTime, hostId: 'laptop', epoch: 1 }
  })
  const s = createHostLeaseService({
    selfHostId: self,
    baseEpoch: 1,
    roleStore: store,
    workspaceId: () => 'band-a',
    readHosts: async () => hosts,
    readAccessCode: async () => '12345678',
    post,
    get,
    now: () => t,
    ...over,
  })
  return { s, post, get, store, advance: (ms: number) => (t += ms) }
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

  it('knows the origins of the listed hosts after it has read the list', async () => {
    const { s } = service('laptop', [primary, backup])
    expect(s.listedOrigins()).toEqual([])
    await s.sendOnce()
    expect(s.listedOrigins()).toEqual(['https://10.0.0.1:8443', 'https://10.0.0.2:8443'])
  })

  it('keeps the last list when the band database cannot be read any more', async () => {
    let fail = false
    const { s } = service('laptop', [primary, backup], { readHosts: async () => { if (fail) throw new Error('db down'); return [primary, backup] } })
    await s.sendOnce()
    fail = true
    await s.sendOnce()
    expect(s.listedOrigins()).toHaveLength(2)
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

describe('takeover (#920)', () => {
  /** A backup that has heard the primary's lease once, 6.5 s ago. `primaryAnswers`: whether a direct request still reaches it. */
  async function silentBackup(primaryAnswers: boolean, silentMs = 5_500) {
    const h = service('stage-pc', [primary, backup], {})
    // Answering: the helper's default (a clock 250 ms ahead). Gone: nothing answers.
    if (!primaryAnswers) h.get.mockResolvedValue(null)
    await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))
    h.advance(silentMs)
    return h
  }

  it('takes over when the lease has been silent for 5 s and the primary does not answer a direct request', async () => {
    const { s, store } = await silentBackup(false)
    expect(await s.takeoverCheck()).toBe('taken')
    expect(s.isActive()).toBe(true)
    expect(s.epoch()).toBe(2)
    expect(store.load()).toEqual({ epoch: 2, active: true })
  })

  it('overlapping checks (the direct request is slow) take over once and raise the epoch once', async () => {
    const { s, get } = await silentBackup(false)
    get.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 30)))
    const results = await Promise.all([s.takeoverCheck(), s.takeoverCheck(), s.takeoverCheck()])
    expect(results.filter((r) => r === 'taken')).toHaveLength(1)
    expect(s.epoch()).toBe(2)
  })

  it('does not take over while the primary still answers directly - only the lease path is broken', async () => {
    const { s } = await silentBackup(true)
    expect(await s.takeoverCheck()).toBe('no')
    expect(s.isActive()).toBe(false)
  })

  it('does not take over after a short silence (a Wi-Fi hiccup of 1-3 s)', async () => {
    const { s } = await silentBackup(false, 3_000)
    expect(await s.takeoverCheck()).toBe('no')
  })

  it('does not take over when it never heard a lease - a backup started alone must not make itself host', async () => {
    const { s, advance } = service('stage-pc', [primary, backup])
    advance(60_000)
    expect(await s.takeoverCheck()).toBe('no')
  })

  it('the primary never takes over, and nobody takes over without two hosts', async () => {
    for (const { s, advance } of [service('laptop', [primary, backup]), service('stage-pc', [backup])]) {
      advance(60_000)
      expect(await s.takeoverCheck()).toBe('no')
    }
  })

  it('takes over once: the next check does nothing and the epoch stays', async () => {
    const { s } = await silentBackup(false)
    await s.takeoverCheck()
    expect(await s.takeoverCheck()).toBe('no')
    expect(s.epoch()).toBe(2)
  })

  it('after a restart the backup is still active, under the same epoch', async () => {
    const { s, store } = await silentBackup(false)
    await s.takeoverCheck()
    const again = service('stage-pc', [primary, backup], { roleStore: store })
    expect(again.s.isActive()).toBe(true)
    expect(again.s.epoch()).toBe(2)
  })

  it('serves band time as its own clock before the takeover, and its own clock plus the primary\'s offset after', async () => {
    // The primary answers while the backup learns its clock (250 ms ahead), then it is gone.
    const { s, get, advance } = await silentBackup(true, 0)
    await s.sampleOnce()
    const before = s.bandTime()
    advance(7_000)
    expect(s.bandTime()).toBe(before + 7_000)
    get.mockResolvedValue(null)
    expect(await s.takeoverCheck()).toBe('taken')
    const now = s.bandTime()
    expect(now - (before + 7_000)).toBeGreaterThan(240)
    expect(now - (before + 7_000)).toBeLessThan(260)
  })

  it('stops following the primary\'s clock once active: the offset is frozen', async () => {
    const { s, get, advance } = await silentBackup(true, 0)
    await s.sampleOnce()
    const offset = s.clockOffsetMs()
    advance(7_000)
    get.mockResolvedValue(null)
    await s.takeoverCheck()
    get.mockClear()
    await s.sampleOnce()
    expect(get).not.toHaveBeenCalled()
    expect(s.clockOffsetMs()).toBe(offset)
  })

  it('a returning primary sees a higher epoch in the backup\'s answer and stops sending leases', async () => {
    const h = service('laptop', [primary, backup])
    h.post.mockResolvedValue({ accepted: false, epoch: 2, active: true })
    h.get.mockResolvedValue({ serverTime: 1, hostId: 'stage-pc', epoch: 2 })
    await h.s.sendOnce()
    h.post.mockClear()
    await h.s.sendOnce()
    expect(h.post).not.toHaveBeenCalled()
    expect(h.s.outdated()).toBe(true)
  })

  it('the lease carries the host\'s current epoch', async () => {
    const h = service('laptop', [primary, backup], { baseEpoch: 3 })
    await h.s.sendOnce()
    expect(verifyLease(h.post.mock.calls[0]![1], KEY)!.epoch).toBe(3)
  })
})

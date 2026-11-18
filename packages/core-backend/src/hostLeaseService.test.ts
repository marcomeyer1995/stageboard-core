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
  const get = vi.fn(async (url?: string): Promise<unknown> => {
    void url
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

describe('is this host the band host? (#938)', () => {
  it('a host with no host list, and a primary that is not out of date, are', async () => {
    expect(service('laptop', null).s.isBandHost()).toBe(true)
    const p = service('laptop', [primary, backup])
    await p.s.sendOnce()
    expect(p.s.isBandHost()).toBe(true)
  })

  it('a passive backup is not, an active one (after the takeover) is', async () => {
    const h = service('stage-pc', [primary, backup])
    h.get.mockResolvedValue(null)
    await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))
    expect(h.s.isBandHost()).toBe(false)
    h.advance(6_000)
    await h.s.takeoverCheck()
    expect(h.s.isBandHost()).toBe(true)
  })

  it('a returned primary that is out of date is not, until it has handed back', async () => {
    const h = service('laptop', [primary, backup], { catchUp: () => ({ state: 'caught-up', lastChangeAt: 0 }), songRunning: async () => false })
    h.get.mockImplementation(async () => ({ serverTime: 1, hostId: 'stage-pc', epoch: 2 }))
    h.post.mockResolvedValue({ accepted: false, epoch: 2, active: true })
    await h.s.sendOnce()
    expect(h.s.isBandHost()).toBe(false)
    for (let i = 0; i < 31; i++) {
      h.advance(1_000)
      await h.s.sendOnce()
    }
    expect(await h.s.handbackCheck()).toBe('handed-back')
    expect(h.s.isBandHost()).toBe(true)
  })

  it('the backup that stepped down after a handback is not', async () => {
    const h = service('stage-pc', [primary, backup])
    h.get.mockResolvedValue(null)
    await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))
    h.advance(6_000)
    await h.s.takeoverCheck()
    await h.s.receive(signLease({ hostId: 'laptop', epoch: 3, leaseMs: 4000, sentAt: 100 }, KEY))
    expect(h.s.isBandHost()).toBe(false)
  })
})

describe('passive backup (#919)', () => {
  it('is true for the backup until it takes over, false for the primary and for a host with no list', async () => {
    const backupHost = service('stage-pc', [primary, backup])
    expect(backupHost.s.passiveBackup()).toBe(false) // nothing read yet
    await backupHost.s.sampleOnce()
    expect(backupHost.s.passiveBackup()).toBe(true)

    const primaryHost = service('laptop', [primary, backup])
    await primaryHost.s.sendOnce()
    expect(primaryHost.s.passiveBackup()).toBe(false)

    const alone = service('stage-pc', null)
    await alone.s.sampleOnce()
    expect(alone.s.passiveBackup()).toBe(false)
  })

  it('stops being passive once it has taken over', async () => {
    const h = service('stage-pc', [primary, backup])
    h.get.mockResolvedValue(null)
    await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))
    expect(h.s.passiveBackup()).toBe(true)
    h.advance(6_000)
    await h.s.takeoverCheck()
    expect(h.s.passiveBackup()).toBe(false)
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

describe('by hand (#943)', () => {
  const caught = { state: 'caught-up' as const, docsCopied: 5, lastChangeAt: 0 }

  async function heardBackup() {
    const h = service('stage-pc', [primary, backup])
    await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))
    return h
  }

  it('"take over now": the passive backup becomes host at once, epoch + 1, while the primary is still alive', async () => {
    const h = await heardBackup()
    expect(await h.s.takeoverNow()).toBe('taken')
    expect(h.s.isActive()).toBe(true)
    expect(h.s.epoch()).toBe(2)
    expect(h.store.load()).toEqual({ epoch: 2, active: true })
  })

  it('"take over now" refuses: not the backup, already the host, no band, or a backup that never heard its primary', async () => {
    const primaryHost = service('laptop', [primary, backup])
    await primaryHost.s.sendOnce()
    expect(await primaryHost.s.takeoverNow()).toBe('refused')
    const active = await heardBackup()
    await active.s.takeoverNow()
    expect(await active.s.takeoverNow()).toBe('refused')
    const none = service('stage-pc', [primary, backup], { workspaceId: () => null })
    expect(await none.s.takeoverNow()).toBe('refused')
    const deaf = service('stage-pc', [primary, backup])
    await deaf.s.sampleOnce()
    expect(await deaf.s.takeoverNow()).toBe('refused')
  })

  /** The returned primary, out of date, with a caught-up copy and no song. */
  async function returned(over: Record<string, unknown> = {}) {
    const h = service('laptop', [primary, backup], { catchUp: () => caught, songRunning: async () => false, ...over })
    h.get.mockImplementation(async () => ({ serverTime: 1, hostId: 'stage-pc', epoch: 2 }))
    h.post.mockResolvedValue({ accepted: false, epoch: 2, active: true })
    await h.s.sendOnce() // learns it is out of date
    h.advance(1_000)
    await h.s.sendOnce() // the backup answers once - the primary has seen it alive
    return h
  }

  it('"hand back now" skips the 30 s wait, but not the rest: the copy must be current and no song may play', async () => {
    const h = await returned()
    expect(await h.s.handbackCheck()).toBe('no') // answered once, but not for 30 s, and not asked
    expect(h.s.requestHandback()).toBe('requested')
    expect(await h.s.handbackCheck()).toBe('handed-back')
    expect(h.s.epoch()).toBe(3)
  })

  it('"hand back now" still waits for the end of a song', async () => {
    let playing = true
    const h = await returned({ songRunning: async () => playing })
    h.s.requestHandback()
    expect(await h.s.handbackCheck()).toBe('no')
    expect(h.s.outdated()).toBe(true)
    playing = false
    expect(await h.s.handbackCheck()).toBe('handed-back')
  })

  it('"hand back now" still waits for the copy', async () => {
    const h = await returned({ catchUp: () => ({ state: 'active' as const, lastChangeAt: 0 }) })
    h.s.requestHandback()
    expect(await h.s.handbackCheck()).toBe('no')
  })

  it('"hand back now" asks for nothing when the host is not out of date, and the wish is gone after the handback', async () => {
    const fine = service('laptop', [primary, backup])
    await fine.s.sendOnce()
    expect(fine.s.requestHandback()).toBe('not-needed')
    const h = await returned()
    h.s.requestHandback()
    await h.s.handbackCheck()
    // out of date again later: the old wish must not skip the wait this time
    h.post.mockResolvedValue({ accepted: false, epoch: 5, active: true })
    h.get.mockImplementation(async () => ({ serverTime: 1, hostId: 'stage-pc', epoch: 5 }))
    await h.s.sendOnce()
    expect(h.s.outdated()).toBe(true)
    expect(await h.s.handbackCheck()).toBe('no')
  })
})

describe('handback (#935)', () => {
  const caught = { state: 'caught-up' as const, docsCopied: 5, lastChangeAt: 0 }

  /** The returned primary: it has seen the backup's higher epoch and the backup answers `/time` with it. */
  async function returnedPrimary(over: Record<string, unknown> = {}, peerEpoch = 2) {
    const h = service('laptop', [primary, backup], { catchUp: () => caught, songRunning: async () => false, ...over })
    h.get.mockImplementation(async () => ({ serverTime: 1, hostId: 'stage-pc', epoch: peerEpoch }))
    h.post.mockResolvedValue({ accepted: false, epoch: peerEpoch, active: true })
    await h.s.sendOnce() // the lease answer tells it: out of date
    expect(h.s.outdated()).toBe(true)
    return h
  }
  /** Lets `seconds` pass with the backup answering every second. */
  async function steady(h: Awaited<ReturnType<typeof returnedPrimary>>, seconds: number) {
    for (let i = 0; i < seconds; i++) {
      h.advance(1_000)
      await h.s.sendOnce()
    }
  }

  it('hands back after 30 s of steady answers, a caught-up copy and no song: epoch = the backup\'s + 1', async () => {
    const h = await returnedPrimary()
    await steady(h, 31)
    expect(await h.s.handbackCheck()).toBe('handed-back')
    expect(h.s.outdated()).toBe(false)
    expect(h.s.epoch()).toBe(3)
    expect(h.store.load()).toEqual({ epoch: 3, active: false })
  })

  it('does not hand back before the answers have been steady for 30 s', async () => {
    const h = await returnedPrimary()
    await steady(h, 10)
    expect(await h.s.handbackCheck()).toBe('no')
    expect(h.s.outdated()).toBe(true)
  })

  it('an unanswered probe starts the 30 s again', async () => {
    const h = await returnedPrimary()
    await steady(h, 20)
    h.get.mockResolvedValueOnce(null)
    await steady(h, 1)
    h.get.mockImplementation(async () => ({ serverTime: 1, hostId: 'stage-pc', epoch: 2 }))
    await steady(h, 15)
    expect(await h.s.handbackCheck()).toBe('no')
    await steady(h, 20)
    expect(await h.s.handbackCheck()).toBe('handed-back')
  })

  it('never while a song is playing - and as soon as it has stopped', async () => {
    let playing = true
    const h = await returnedPrimary({ songRunning: async () => playing })
    await steady(h, 40)
    expect(await h.s.handbackCheck()).toBe('no')
    expect(h.s.outdated()).toBe(true)
    playing = false
    expect(await h.s.handbackCheck()).toBe('handed-back')
  })

  it('not while the copy of the backup\'s data is behind, not started, or changed in the last 2 s', async () => {
    for (const status of [{ ...caught, state: 'behind' as const }, { ...caught, state: 'active' as const }, null]) {
      const h = await returnedPrimary({ catchUp: () => status })
      await steady(h, 35)
      expect(await h.s.handbackCheck()).toBe('no')
    }
    const recent = await returnedPrimary({ catchUp: () => ({ ...caught, lastChangeAt: 10_000 + 36_000 - 500 }) })
    await steady(recent, 36)
    expect(await recent.s.handbackCheck()).toBe('no')
  })

  it('does not hand back when the song state cannot be read (it must not guess)', async () => {
    const h = await returnedPrimary({ songRunning: async () => { throw new Error('db down') } })
    await steady(h, 40)
    expect(await h.s.handbackCheck()).toBe('no')
  })

  it('a primary that is not out of date, and a backup, never hand back', async () => {
    const fine = service('laptop', [primary, backup], { catchUp: () => caught, songRunning: async () => false })
    fine.advance(60_000)
    expect(await fine.s.handbackCheck()).toBe('no')
    const backupHost = service('stage-pc', [primary, backup], { catchUp: () => caught, songRunning: async () => false })
    backupHost.advance(60_000)
    expect(await backupHost.s.handbackCheck()).toBe('no')
  })

  it('after the handback the lease goes out again under the new epoch', async () => {
    const h = await returnedPrimary()
    await steady(h, 31)
    await h.s.handbackCheck()
    h.post.mockClear()
    h.post.mockResolvedValue({ accepted: true, epoch: 2, active: true })
    await h.s.sendOnce()
    expect(verifyLease(h.post.mock.calls[0]![1], KEY)!.epoch).toBe(3)
  })

  it('checks one at a time: two overlapping checks hand back once', async () => {
    const h = await returnedPrimary({ songRunning: () => new Promise((r) => setTimeout(() => r(false), 20)) })
    await steady(h, 31)
    const results = await Promise.all([h.s.handbackCheck(), h.s.handbackCheck()])
    expect(results.filter((r) => r === 'handed-back')).toHaveLength(1)
    expect(h.s.epoch()).toBe(3)
  })

  describe('the backup steps down', () => {
    async function activeBackup() {
      const h = service('stage-pc', [primary, backup])
      h.get.mockResolvedValue(null)
      await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }, KEY))
      h.advance(6_000)
      expect(await h.s.takeoverCheck()).toBe('taken')
      return h
    }

    it('on a signed lease from the primary with a higher epoch: passive again, the epoch kept', async () => {
      const h = await activeBackup()
      expect(h.s.isActive()).toBe(true)
      expect(await h.s.receive(signLease({ hostId: 'laptop', epoch: 3, leaseMs: 4000, sentAt: 100 }, KEY))).toBe('accepted')
      expect(h.s.isActive()).toBe(false)
      expect(h.s.passiveBackup()).toBe(true)
      expect(h.s.epoch()).toBe(3)
      expect(h.store.load()).toEqual({ epoch: 3, active: false })
    })

    it('not on a lease with the same or a lower epoch (the old primary waking up must not take the host back)', async () => {
      const h = await activeBackup()
      await h.s.receive(signLease({ hostId: 'laptop', epoch: 2, leaseMs: 4000, sentAt: 100 }, KEY))
      await h.s.receive(signLease({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 200 }, KEY))
      expect(h.s.isActive()).toBe(true)
      expect(h.s.epoch()).toBe(2)
    })

    it('not on an unsigned or wrongly signed lease', async () => {
      const h = await activeBackup()
      await h.s.receive({ lease: { hostId: 'laptop', epoch: 9, leaseMs: 4000, sentAt: 300 }, sig: 'a'.repeat(64) })
      await h.s.receive(signLease({ hostId: 'laptop', epoch: 9, leaseMs: 4000, sentAt: 301 }, leaseKey('00000000', 'band-a')))
      expect(h.s.isActive()).toBe(true)
    })

    it('follows the primary\'s clock again once passive', async () => {
      const h = await activeBackup()
      await h.s.receive(signLease({ hostId: 'laptop', epoch: 3, leaseMs: 4000, sentAt: 100 }, KEY))
      h.get.mockImplementation(async () => ({ serverTime: 10_000_000, hostId: 'laptop', epoch: 3 }))
      h.get.mockClear()
      await h.s.sampleOnce()
      expect(h.get).toHaveBeenCalled()
    })
  })
})

describe('teaching a listed backup its band (#945)', () => {
  const selfUrl = 'https://10.0.0.1:8443'
  /** Answers `/server/active-workspace` with the given band, everything else like the plain fixture. */
  function inviter(activeWorkspaceId: string | null, over: Partial<Parameters<typeof createHostLeaseService>[0]> = {}) {
    const h = service('laptop', [primary, backup], { selfUrl, selfFingerprint: FP1, ...over })
    h.get.mockImplementation(async (url = '') => {
      if (url.endsWith('/server/active-workspace')) return { activeWorkspaceId }
      return { serverTime: 10_250, hostId: 'laptop', epoch: 1 }
    })
    return h
  }

  it('the primary invites a listed backup that serves no band - with the code, its own address and fingerprint', async () => {
    const { s, post } = inviter(null)
    await s.sendOnce()
    const invite = post.mock.calls.find((c) => String(c[0]).endsWith('/host/join-band-invite'))
    expect(invite).toBeDefined()
    const [url, body, fingerprint] = invite!
    expect(url).toBe('https://10.0.0.2:8443/host/join-band-invite')
    expect(body).toEqual({
      workspaceId: 'band-a',
      accessCode: '12345678',
      primaryUrl: selfUrl,
      targetHostId: 'stage-pc',
      fingerprint: FP1,
      sentAt: 10_000,
    })
    // The invitation goes to the address and certificate the band's list names, not to whatever answers.
    expect(fingerprint).toBe(FP2)
  })

  it('does not invite a backup that already serves this band, or another one', async () => {
    for (const band of ['band-a', 'another-band']) {
      const { s, post } = inviter(band)
      await s.sendOnce()
      expect(post.mock.calls.some((c) => String(c[0]).endsWith('/host/join-band-invite'))).toBe(false)
    }
  })

  it('repeats the invitation after the interval, not on every lease', async () => {
    const { s, post, advance } = inviter(null)
    const invites = () => post.mock.calls.filter((c) => String(c[0]).endsWith('/host/join-band-invite')).length
    await s.sendOnce()
    advance(1_000)
    await s.sendOnce()
    expect(invites()).toBe(1)
    advance(5_000)
    await s.sendOnce()
    expect(invites()).toBe(2)
  })

  it('sends no invitation as the backup, and none when the other host does not answer properly', async () => {
    const asBackup = service('stage-pc', [primary, backup], { selfUrl: 'https://10.0.0.2:8443', selfFingerprint: FP2 })
    await asBackup.s.sendOnce()
    expect(asBackup.post.mock.calls.some((c) => String(c[0]).endsWith('/host/join-band-invite'))).toBe(false)

    for (const answer of [null, {}, { activeWorkspaceId: 7 }]) {
      const { s, post } = inviter(null, {})
      s // keep the fixture's own get
      const h = service('laptop', [primary, backup], { selfUrl, selfFingerprint: FP1 })
      h.get.mockImplementation(async () => answer)
      await h.s.sendOnce()
      expect(h.post.mock.calls.some((c) => String(c[0]).endsWith('/host/join-band-invite'))).toBe(false)
      expect(post).toBeDefined()
      expect(s).toBeDefined()
    }
  })
})

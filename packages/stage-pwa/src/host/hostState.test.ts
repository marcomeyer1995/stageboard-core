import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { createHostStateMachine, TAKEOVER_AFTER_MS, type HostRole } from './hostState'
import { leaseKey, signLease } from './leaseAuth'

const CODE = '57832943'
const WORKSPACE = 'leasetest'
const SELF = 'tablet-1'
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: 'a'.repeat(64), priority: 1 }
const backup: BandHostEntry = { hostId: SELF, url: 'https://10.0.0.2:8443', certFingerprint: 'b'.repeat(64), priority: 2 }

let now = 1_000_000
const lease = (epoch: number, sentAt = now) => ({ hostId: 'laptop', epoch, leaseMs: 4_000, sentAt })

function machine(overrides: { hosts?: BandHostEntry[]; probe?: () => Promise<unknown>; saved?: HostRole | null } = {}) {
  let saved = overrides.saved ?? null
  const probe = vi.fn(overrides.probe ?? (async () => ({ serverTime: now })))
  const hosts = overrides.hosts ?? [primary, backup]
  const post = vi.fn(async () => null)
  const m = createHostStateMachine({
    post,
    selfHostId: SELF,
    workspaceId: WORKSPACE,
    baseEpoch: 1,
    loadRole: () => saved,
    saveRole: (role) => {
      saved = role
    },
    hosts: () => hosts,
    keys: async () => [await leaseKey(CODE, WORKSPACE)],
    get: probe,
    now: () => now,
  })
  return { m, probe, post, hosts, saved: () => saved }
}

async function accept(m: ReturnType<typeof machine>['m'], epoch: number, sentAt = now) {
  return m.acceptLease(await signLease(lease(epoch, sentAt), await leaseKey(CODE, WORKSPACE)))
}

describe('lease and takeover on the tablet (#947)', () => {
  beforeEach(() => {
    now = 1_000_000
  })

  it('takes over after 5 s of silence when the primary does not answer either', async () => {
    const { m, probe } = machine({ probe: async () => null })
    expect(await accept(m, 1)).toBe('accepted')
    now += TAKEOVER_AFTER_MS - 1
    expect(await m.takeoverCheck()).toBe('no')
    now += 1
    expect(await m.takeoverCheck()).toBe('taken')
    expect(probe).toHaveBeenCalledWith('https://10.0.0.1:8443/time', primary.certFingerprint)
    expect(m.state()).toEqual({ hostId: SELF, epoch: 2, active: true, priority: 2, outdated: false })
  })

  it('treats a probe that throws (primary unreachable) as no answer', async () => {
    const { m } = machine({ probe: async () => Promise.reject(new Error('connect failed')) })
    await accept(m, 1)
    now += TAKEOVER_AFTER_MS + 1
    expect(await m.takeoverCheck()).toBe('taken')
  })

  it('stays passive while the primary still answers directly', async () => {
    const { m } = machine({ probe: async () => ({ serverTime: now }) })
    await accept(m, 1)
    now += TAKEOVER_AFTER_MS + 1
    expect(await m.takeoverCheck()).toBe('no')
    expect(m.state().active).toBe(false)
  })

  it('never takes over without having heard the primary, or while not the listed backup', async () => {
    const alone = machine()
    expect(await alone.m.takeoverCheck()).toBe('no')
    const { m: notBackup } = machine({ hosts: [primary, { ...backup, priority: 2, hostId: 'other' }] })
    await accept(notBackup, 1)
    now += TAKEOVER_AFTER_MS + 1
    expect(await notBackup.takeoverCheck()).toBe('no')
  })

  it('ignores a lease from itself or from a host the band does not list', async () => {
    const { m } = machine()
    const key = await leaseKey(CODE, WORKSPACE)
    expect(await m.acceptLease(await signLease({ ...lease(1), hostId: SELF }, key))).toBe('ignored')
    expect(await m.acceptLease(await signLease({ ...lease(1), hostId: 'stranger' }, key))).toBe('ignored')
    expect(await m.acceptLease(await signLease(lease(1), await leaseKey('11111111', WORKSPACE)))).toBe('ignored')
    expect(m.lease()).toBeNull()
  })

  it('refuses a replayed or older lease', async () => {
    const { m } = machine()
    await accept(m, 2, now + 100)
    expect(await accept(m, 2, now + 100)).toBe('ignored')
    expect(await accept(m, 1, now + 200)).toBe('ignored')
    expect(await accept(m, 2, now + 101)).toBe('accepted')
  })

  it('steps down when the returned primary announces a higher epoch (#935)', async () => {
    const { m, saved } = machine({ probe: async () => null })
    await accept(m, 1)
    now += TAKEOVER_AFTER_MS + 1
    expect(await m.takeoverCheck()).toBe('taken')
    now += 1_000
    expect(await accept(m, 3)).toBe('accepted')
    expect(m.state()).toEqual({ hostId: SELF, epoch: 3, active: false, priority: 2, outdated: false })
    expect(saved()).toEqual({ epoch: 3, active: false })
  })

  it('takes over at once on the admin command, but only after hearing the primary', async () => {
    const { m } = machine()
    expect(await m.takeoverNow()).toBe('refused')
    await accept(m, 1)
    expect(await m.takeoverNow()).toBe('taken')
    expect(m.state().active).toBe(true)
  })

  it('reports no priority while the band lists only this host', async () => {
    const { m } = machine({ hosts: [backup] })
    expect(m.state().priority).toBeNull()
  })
})

// --- The tablet as the primary (#947) ---

const tabletPrimary: BandHostEntry = { hostId: SELF, url: 'https://10.0.0.2:8443', certFingerprint: 'b'.repeat(64), priority: 1 }
const laptopBackup: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: 'a'.repeat(64), priority: 2 }

function primaryMachine(over: { post?: (url: string, body: unknown) => Promise<unknown>; get?: (url: string) => Promise<unknown>; catchUp?: () => { state: string; lastChangeAt: number | null } | null; songRunning?: () => Promise<boolean> } = {}) {
  let saved: HostRole | null = null
  const posts: { url: string; body: unknown }[] = []
  const post = vi.fn(async (url: string, body: unknown) => {
    posts.push({ url, body })
    return (over.post ?? (async () => ({ accepted: true, epoch: 1, active: false })))(url, body)
  })
  const get = vi.fn(over.get ?? (async (url: string) => (url.endsWith('/server/active-workspace') ? { activeWorkspaceId: 'leasetest' } : { serverTime: now, hostId: 'laptop', epoch: 1, active: false })))
  const m = createHostStateMachine({
    selfHostId: SELF,
    workspaceId: WORKSPACE,
    baseEpoch: 1,
    loadRole: () => saved,
    saveRole: (role) => {
      saved = role
    },
    hosts: () => [tabletPrimary, laptopBackup],
    keys: async () => [await leaseKey(CODE, WORKSPACE)],
    get,
    post,
    now: () => now,
    self: () => ({ url: tabletPrimary.url, fingerprint: tabletPrimary.certFingerprint! }),
    accessCode: async () => CODE,
    catchUp: over.catchUp,
    songRunning: over.songRunning,
  })
  return { m, post, get, posts, saved: () => saved }
}

describe('the tablet as the primary (#947)', () => {
  beforeEach(() => {
    now = 1_000_000
  })

  it('serves the band at once and sends a signed lease the laptop accepts', async () => {
    const { m, posts } = primaryMachine()
    expect(m.state()).toEqual({ hostId: SELF, epoch: 1, active: true, priority: 1, outdated: false })
    await m.sendOnce()
    const lease = posts.find((p) => p.url === 'https://10.0.0.1:8443/host/lease')!
    const key = await leaseKey(CODE, WORKSPACE)
    expect(await (await import('./leaseAuth')).verifyLease(lease.body, key)).toMatchObject({ hostId: SELF, epoch: 1, leaseMs: 4_000 })
  })

  it('lets sentAt rise even within one millisecond', async () => {
    const { m, posts } = primaryMachine()
    await m.sendOnce()
    await m.sendOnce()
    const leases = posts.filter((p) => p.url.endsWith('/host/lease')).map((p) => (p.body as { lease: { sentAt: number } }).lease.sentAt)
    expect(leases[1]).toBeGreaterThan(leases[0]!)
  })

  it('sends nothing while it is not the listed primary', async () => {
    const { m, post } = machine()
    await m.sendOnce()
    expect(post).not.toHaveBeenCalled()
  })

  it('becomes out of date when the backup answers under a higher epoch, and stops serving', async () => {
    const { m, posts } = primaryMachine({ post: async () => ({ accepted: true, epoch: 2, active: true }) })
    await m.sendOnce()
    expect(m.state()).toMatchObject({ active: false, outdated: true })
    const before = posts.length
    await m.sendOnce()
    expect(posts.length).toBe(before) // quiet while out of date: it only watches
  })

  it('invites a listed backup that serves no band yet - only every 5 s', async () => {
    const { m, posts } = primaryMachine({ get: async (url) => (url.endsWith('/server/active-workspace') ? { activeWorkspaceId: null } : { serverTime: now }) })
    await m.sendOnce()
    const invites = () => posts.filter((p) => p.url.endsWith('/host/join-band-invite'))
    expect(invites()).toHaveLength(1)
    expect(invites()[0]!.body).toMatchObject({ workspaceId: WORKSPACE, accessCode: CODE, primaryUrl: tabletPrimary.url, targetHostId: 'laptop', fingerprint: tabletPrimary.certFingerprint })
    now += 1_000
    await m.sendOnce()
    expect(invites()).toHaveLength(1)
    now += 4_500
    await m.sendOnce()
    expect(invites()).toHaveLength(2)
  })

  it('never invites a backup that already serves a band', async () => {
    const { m, posts } = primaryMachine()
    await m.sendOnce()
    expect(posts.filter((p) => p.url.endsWith('/host/join-band-invite'))).toHaveLength(0)
  })

  describe('handing back', () => {
    async function outdatedMachine(over: Parameters<typeof primaryMachine>[0] = {}) {
      let backupEpoch = 2
      const r = primaryMachine({
        post: async () => ({ accepted: true, epoch: backupEpoch, active: true }),
        get: async (url) => (url.endsWith('/server/active-workspace') ? { activeWorkspaceId: 'x' } : { serverTime: now, hostId: 'laptop', epoch: backupEpoch, active: true }),
        catchUp: () => ({ state: 'caught-up', lastChangeAt: now - 10_000 }),
        songRunning: async () => false,
        ...over,
      })
      await r.m.sendOnce() // learns it is out of date
      return { ...r, setBackupEpoch: (e: number) => (backupEpoch = e) }
    }

    it('takes the host role back above the backup\'s epoch after 30 s of steady answers, a current copy and no song', async () => {
      const { m, saved } = await outdatedMachine()
      await m.sendOnce()
      expect(await m.handbackCheck()).toBe('no') // not steady yet
      now += 30_000
      await m.sendOnce()
      expect(await m.handbackCheck()).toBe('handed-back')
      expect(m.state()).toMatchObject({ epoch: 3, active: true, outdated: false })
      expect(saved()).toEqual({ epoch: 3, active: false })
    })

    it('waits for the copy to be current and quiet', async () => {
      let copy: { state: string; lastChangeAt: number | null } | null = { state: 'active', lastChangeAt: now }
      const { m } = await outdatedMachine({ catchUp: () => copy })
      await m.sendOnce()
      now += 31_000
      await m.sendOnce()
      expect(await m.handbackCheck()).toBe('no')
      copy = { state: 'caught-up', lastChangeAt: now - 500 }
      expect(await m.handbackCheck()).toBe('no')
      copy = { state: 'caught-up', lastChangeAt: now - 3_000 }
      expect(await m.handbackCheck()).toBe('handed-back')
    })

    it('never hands back during a song, nor when it cannot tell', async () => {
      let song: () => Promise<boolean> = async () => true
      const { m } = await outdatedMachine({ songRunning: () => song() })
      await m.sendOnce()
      now += 31_000
      await m.sendOnce()
      expect(await m.handbackCheck()).toBe('no')
      song = async () => {
        throw new Error('unreadable')
      }
      expect(await m.handbackCheck()).toBe('no')
      song = async () => false
      expect(await m.handbackCheck()).toBe('handed-back')
    })

    it('starts the 30 s again when the backup stops answering', async () => {
      const r = await outdatedMachine()
      await r.m.sendOnce()
      now += 20_000
      r.get.mockImplementationOnce(async () => null)
      await r.m.sendOnce()
      now += 20_000
      await r.m.sendOnce()
      expect(await r.m.handbackCheck()).toBe('no')
    })
  })
})

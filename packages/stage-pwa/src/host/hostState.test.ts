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
  const m = createHostStateMachine({
    selfHostId: SELF,
    baseEpoch: 1,
    loadRole: () => saved,
    saveRole: (role) => {
      saved = role
    },
    hosts: () => hosts,
    keys: async () => [await leaseKey(CODE, WORKSPACE)],
    probePrimary: probe,
    now: () => now,
  })
  return { m, probe, hosts, saved: () => saved }
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
    expect(probe).toHaveBeenCalledWith('https://10.0.0.1:8443', primary.certFingerprint)
    expect(m.state()).toEqual({ hostId: SELF, epoch: 2, active: true, priority: 2 })
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
    expect(m.state()).toEqual({ hostId: SELF, epoch: 3, active: false, priority: 2 })
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

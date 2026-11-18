import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { createBandBootstrapStore, effectiveHosts, joinBand, joinFromMap, type Bootstrap } from './bandJoin.js'

const FP = 'a'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: FP, priority: 1 }
const self: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }
const input = { workspaceId: 'band-a', accessCode: '12345678', primaryUrl: 'https://10.0.0.1:8443/', certFingerprint: FP }

function setup(over: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'join-'))
  const store = createBandBootstrapStore(dir)
  const calls: string[] = []
  const deps = {
    selfHostId: 'stage-pc',
    selfUrl: 'https://10.0.0.2:8443',
    activeWorkspaceId: () => null as string | null,
    fetchPrimaryId: vi.fn(async () => 'laptop' as string | null),
    ensureLocalDb: vi.fn(async () => void calls.push('db')),
    activate: vi.fn(async () => void calls.push('activate')),
    store,
    ...over,
  }
  return { deps, store, calls, dir }
}

describe('joinBand (#933)', () => {
  it('reads the primary, makes the database, stores the join file, and only then activates the band', async () => {
    const { deps, store, calls } = setup()
    expect(await joinBand(deps, input)).toEqual({ ok: true })
    expect(deps.fetchPrimaryId).toHaveBeenCalledWith('https://10.0.0.1:8443', FP)
    expect(calls).toEqual(['db', 'activate'])
    expect(store.load()).toEqual({ workspaceId: 'band-a', accessCode: '12345678', hosts: [{ ...primary, url: 'https://10.0.0.1:8443' }, self] })
  })

  it('refuses bad input without touching anything', async () => {
    for (const bad of [{}, { ...input, workspaceId: '' }, { ...input, accessCode: '' }, { ...input, primaryUrl: 'http://10.0.0.1' }, { ...input, certFingerprint: 'AA:BB' }]) {
      const { deps, store } = setup()
      expect(await joinBand(deps, bad)).toMatchObject({ ok: false, status: 400 })
      expect(deps.ensureLocalDb).not.toHaveBeenCalled()
      expect(store.load()).toBeNull()
    }
  })

  it('refuses when another band is already active on this host, and changes nothing', async () => {
    const { deps, store } = setup({ activeWorkspaceId: () => 'band-b' })
    expect(await joinBand(deps, input)).toMatchObject({ ok: false, status: 409 })
    expect(deps.activate).not.toHaveBeenCalled()
    expect(store.load()).toBeNull()
  })

  it('joining the band that is already active again is fine (the join is repeated)', async () => {
    const { deps } = setup({ activeWorkspaceId: () => 'band-a' })
    expect(await joinBand(deps, input)).toEqual({ ok: true })
  })

  it('refuses a primary that does not answer, or one with this host\'s own id', async () => {
    const down = setup({ fetchPrimaryId: vi.fn(async () => null) })
    expect(await joinBand(down.deps, input)).toMatchObject({ ok: false, status: 502 })
    expect(down.store.load()).toBeNull()
    const same = setup({ fetchPrimaryId: vi.fn(async () => 'stage-pc') })
    expect(await joinBand(same.deps, input)).toMatchObject({ ok: false, status: 400 })
  })

  it('does not throw when the database cannot be made, and stores nothing', async () => {
    const { deps, store } = setup({ ensureLocalDb: vi.fn().mockRejectedValue(new Error('couch down')) })
    expect(await joinBand(deps, input)).toMatchObject({ ok: false, status: 500 })
    expect(deps.activate).not.toHaveBeenCalled()
    expect(store.load()).toBeNull()
  })
})

describe('bootstrap store (#933)', () => {
  it('keeps what was saved across a restart, in a file only its owner can read', () => {
    const { store, dir } = setup()
    const b: Bootstrap = { workspaceId: 'band-a', accessCode: '12345678', hosts: [primary, self] }
    store.save(b)
    expect(createBandBootstrapStore(dir).load()).toEqual(b)
    expect(statSync(join(dir, 'join-band.json')).mode & 0o077).toBe(0)
    expect(readFileSync(join(dir, 'join-band.json'), 'utf8')).toContain('12345678')
  })

  it('a missing or broken file is "not joined", never an error', () => {
    const { store, dir } = setup()
    expect(store.load()).toBeNull()
    writeFileSync(join(dir, 'join-band.json'), '{nonsense')
    expect(store.load()).toBeNull()
    writeFileSync(join(dir, 'join-band.json'), JSON.stringify({ workspaceId: 'x', accessCode: '', hosts: [] }))
    expect(store.load()).toBeNull()
  })
})

describe('effectiveHosts (#933)', () => {
  const boot: Bootstrap = { workspaceId: 'band-a', accessCode: '1', hosts: [primary, self] }

  it('the band\'s own list wins as soon as it has two hosts', () => {
    const own = [{ ...primary, url: 'https://own-list:1' }, self]
    expect(effectiveHosts('band-a', own, boot)).toEqual(own)
  })

  it('the join file stands in while the band has no list (or fewer than two)', () => {
    expect(effectiveHosts('band-a', null, boot)).toEqual(boot.hosts)
    expect(effectiveHosts('band-a', [primary], boot)).toEqual(boot.hosts)
  })

  it('the join file counts for its own band only', () => {
    expect(effectiveHosts('band-b', null, boot)).toBeNull()
    expect(effectiveHosts('band-a', null, null)).toBeNull()
  })
})

describe('joining from the stage map (#945)', () => {
  /** How the map asks a fresh host to join: the band's code is the proof, and the host must be the one named. */
  const invite = { workspaceId: 'band-a', accessCode: '12345678', primaryUrl: 'https://10.0.0.1:8443', targetHostId: 'stage-pc', primaryHostId: 'laptop', fingerprint: 'f'.repeat(64), sentAt: 10_000 }

  function invited(over: Record<string, unknown> = {}) {
    const { deps, store } = setup()
    const verifyWithPrimary = vi.fn(async () => 'laptop' as string | null)
    const s = joinFromMap({ ...deps, verifyWithPrimary, now: () => 10_000, ...over })
    return { s, deps, store, verifyWithPrimary: (over.verifyWithPrimary as typeof verifyWithPrimary) ?? verifyWithPrimary }
  }

  it('a fresh host joins the band the map names, proving the code with the primary, pinned to the primary\'s fingerprint', async () => {
    const { s, deps, verifyWithPrimary, store } = invited()
    expect(await s(invite)).toEqual({ ok: true })
    expect(verifyWithPrimary).toHaveBeenCalledWith('https://10.0.0.1:8443', 'band-a', '12345678', invite.fingerprint)
    expect(deps.ensureLocalDb).toHaveBeenCalledWith('band-a')
    expect(store.load()).toMatchObject({ workspaceId: 'band-a', accessCode: '12345678', lastInviteAt: 10_000 })
    expect(store.load()!.hosts.map((h) => [h.hostId, h.priority, h.certFingerprint])).toEqual([['laptop', 1, invite.fingerprint], ['stage-pc', 2, undefined]])
  })

  it('refuses when the invite is for another host - a stranger on the network cannot redirect a host', async () => {
    const { s, store } = invited()
    expect(await s({ ...invite, targetHostId: 'another-host' })).toMatchObject({ ok: false, status: 400 })
    expect(store.load()).toBeNull()
  })

  it('refuses when the primary does not confirm the code, without storing anything', async () => {
    const { s, verifyWithPrimary, store } = invited({ verifyWithPrimary: vi.fn(async () => null) })
    expect(await s(invite)).toMatchObject({ ok: false, status: 403 })
    expect(verifyWithPrimary).toHaveBeenCalled()
    expect(store.load()).toBeNull()
  })

  it('refuses a replay: the same sentAt, or an older one, cannot join again', async () => {
    const { s, store } = invited()
    expect(await s(invite)).toEqual({ ok: true })
    expect(await s(invite)).toMatchObject({ ok: false, status: 409 })
    expect(await s({ ...invite, sentAt: 9_000 })).toMatchObject({ ok: false, status: 409 })
    expect(store.load()).toMatchObject({ lastInviteAt: 10_000 })
  })

  it('the stored time survives a restart: a new service with the same file still refuses the replay', async () => {
    const first = invited()
    await first.s(invite)
    const second = joinFromMap({ ...first.deps, verifyWithPrimary: vi.fn(async () => 'laptop'), now: () => 10_000 })
    expect(await second(invite)).toMatchObject({ ok: false, status: 409 })
  })

  it('accepts a later invite (the admin repeats the step), updating the code and the host list', async () => {
    const { s, store } = invited()
    await s(invite)
    expect(await s({ ...invite, sentAt: 11_000, accessCode: '87654321' })).toEqual({ ok: true })
    expect(store.load()).toMatchObject({ accessCode: '87654321', lastInviteAt: 11_000 })
  })

  it('refuses bad input and does not throw when the primary cannot be reached', async () => {
    const { s, store } = invited({ verifyWithPrimary: vi.fn().mockRejectedValue(new Error('down')) })
    expect(await s({ ...invite, primaryUrl: 'http://10.0.0.1' })).toMatchObject({ ok: false, status: 400 })
    expect(await s(invite)).toMatchObject({ ok: false, status: 502 })
    expect(store.load()).toBeNull()
  })

  it('refuses while this host already serves another band', async () => {
    const { s, store } = invited({ activeWorkspaceId: () => 'other-band' })
    expect(await s(invite)).toMatchObject({ ok: false, status: 409 })
    expect(store.load()).toBeNull()
  })
})

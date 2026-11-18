import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { createBandBootstrapStore, effectiveHosts, joinBand, type Bootstrap } from './bandJoin.js'

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

import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import ReplicationPlugin from 'pouchdb-replication'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { leaseKey, verifyAccountRequest } from './hostLeaseAuth.js'
import { createReplicationRunner, type ReplicationRunner } from './replicationRunner.js'

PouchDB.plugin(MemoryAdapter)
PouchDB.plugin(ReplicationPlugin)

const FP = 'a'.repeat(64)
const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', certFingerprint: FP, priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }
let n = 0
const fresh = () => new PouchDB<Record<string, unknown>>(`run-${Date.now()}-${n++}`, { adapter: 'memory' })
const until = async (check: () => Promise<boolean> | boolean, ms = 3_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

let runner: ReplicationRunner | null = null
afterEach(() => runner?.stop())

function setup(self = 'stage-pc', hosts: BandHostEntry[] | null = [primary, backup], over: Record<string, unknown> = {}) {
  const remote = fresh()
  const local = fresh()
  const requestAccount = vi.fn().mockResolvedValue({ username: 'stageboard-band-a-host~stage-pc', password: 'pw' })
  const makeRemote = vi.fn(() => remote)
  const makeLocal = vi.fn(async () => local)
  runner = createReplicationRunner({
    selfHostId: self,
    workspaceId: () => 'band-a',
    readHosts: async () => hosts,
    readAccessCode: async () => '12345678',
    requestAccount,
    makeRemote,
    makeLocal,
    now: () => 1_000,
    ...over,
  })
  return { runner, remote, local, requestAccount, makeRemote, makeLocal }
}

describe('replication runner (#919)', () => {
  it('the backup asks the primary for an account (signed, pinned to its fingerprint) and then copies its database', async () => {
    const { runner, remote, local, requestAccount, makeRemote } = setup()
    await remote.put({ _id: 'profiles:a', name: 'Alex' })
    await runner.tick()
    const [url, body, fingerprint] = requestAccount.mock.calls[0]!
    expect(url).toBe('https://10.0.0.1:8443/host/replication-account')
    expect(fingerprint).toBe(FP)
    expect(verifyAccountRequest(body, leaseKey('12345678', 'band-a'))).toMatchObject({ hostId: 'stage-pc' })
    expect(makeRemote).toHaveBeenCalledWith({ baseUrl: 'https://10.0.0.1:8443', workspaceId: 'band-a', fingerprint: FP, auth: { username: 'stageboard-band-a-host~stage-pc', password: 'pw' } })
    expect(await until(async () => (await local.get('profiles:a').catch(() => null)) !== null)).toBe(true)
  })

  it('asks once: while the copy runs, later ticks do nothing', async () => {
    const { runner, requestAccount } = setup()
    await runner.tick()
    await runner.tick()
    await runner.tick()
    expect(requestAccount).toHaveBeenCalledTimes(1)
  })

  it('tries again on the next tick when the primary gave no account', async () => {
    const { runner, requestAccount, makeRemote } = setup()
    requestAccount.mockResolvedValueOnce(null)
    await runner.tick()
    expect(makeRemote).not.toHaveBeenCalled()
    await runner.tick()
    expect(makeRemote).toHaveBeenCalledTimes(1)
  })

  it('does nothing as the primary, without two hosts, without a band or when the primary is not listed', async () => {
    for (const h of [setup('laptop'), setup('stage-pc', [backup]), setup('stage-pc', null), setup('stage-pc', [primary, backup], { workspaceId: () => null })]) {
      await h.runner.tick()
      expect(h.requestAccount).not.toHaveBeenCalled()
      h.runner.stop()
    }
  })

  it('a failing request or an unusable answer does not throw', async () => {
    const { runner, requestAccount } = setup()
    requestAccount.mockRejectedValueOnce(new Error('down'))
    await expect(runner.tick()).resolves.toBeUndefined()
    requestAccount.mockResolvedValueOnce({ nonsense: true })
    await expect(runner.tick()).resolves.toBeUndefined()
    expect(runner.status()).toBeNull()
  })

  it('reports how current the copy is', async () => {
    const { runner, remote } = setup()
    await remote.put({ _id: 'a' })
    expect(runner.status()).toBeNull()
    await runner.tick()
    expect(await until(() => runner.status()?.state === 'caught-up')).toBe(true)
  })
})

describe('replication runner, copying from the other host (#935)', () => {
  const asReturnedPrimary = (wanted: () => boolean) => ({
    copyFrom: (hosts: readonly BandHostEntry[], self: string) => (wanted() ? (hosts.find((h) => h.hostId !== self) ?? null) : null),
  })

  it('the returned primary asks the BACKUP for an account and copies its database', async () => {
    const { runner, remote, local, requestAccount, makeRemote } = setup('laptop', [primary, backup], asReturnedPrimary(() => true))
    await remote.put({ _id: 'written-during-takeover', x: 1 })
    await runner.tick()
    expect(requestAccount.mock.calls[0]![0]).toBe('https://10.0.0.2:8443/host/replication-account')
    expect(makeRemote).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://10.0.0.2:8443' }))
    expect(await until(async () => (await local.get('written-during-takeover').catch(() => null)) !== null)).toBe(true)
  })

  it('does nothing while it is not wanted, and starts once it is', async () => {
    let wanted = false
    const { runner, requestAccount } = setup('laptop', [primary, backup], asReturnedPrimary(() => wanted))
    await runner.tick()
    expect(requestAccount).not.toHaveBeenCalled()
    wanted = true
    await runner.tick()
    expect(requestAccount).toHaveBeenCalledTimes(1)
  })

  it('stops the copy when it is not wanted any more (the handback is done), so the old backup is not pulled from for good', async () => {
    let wanted = true
    const { runner } = setup('laptop', [primary, backup], asReturnedPrimary(() => wanted))
    await runner.tick()
    expect(runner.status()).not.toBeNull()
    wanted = false
    await runner.tick()
    expect(runner.status()).toBeNull()
  })

  it('the default stays what it was: only the backup copies, from the primary', async () => {
    const { runner, requestAccount } = setup('laptop')
    await runner.tick()
    expect(requestAccount).not.toHaveBeenCalled()
  })
})

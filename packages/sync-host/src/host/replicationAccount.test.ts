import { describe, expect, it, vi, beforeAll } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { leaseKey, signAccountRequest } from './leaseAuth.js'
import { createReplicationAccountIssuer } from './replicationAccount.js'

const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }
let KEY: CryptoKey
beforeAll(async () => {
  KEY = await leaseKey('12345678', 'band-a')
})

function issuer(self = 'laptop', hosts: BandHostEntry[] | null = [primary, backup], over: Partial<Parameters<typeof createReplicationAccountIssuer>[0]> = {}) {
  const mint = vi.fn(async (_workspaceId: string, hostId: string) => ({ username: `stageboard-band-a-host~${hostId}`, password: 'secret' }))
  const i = createReplicationAccountIssuer({ selfHostId: self, workspaceId: () => 'band-a', readHosts: async () => hosts, readAccessCode: async () => '12345678', mint, ...over })
  return { i, mint }
}
const request = async (over: object = {}, key = KEY) => signAccountRequest({ hostId: 'stage-pc', sentAt: 1, ...over }, key)

describe('replication account issuer (#919)', () => {
  it('gives the backup a read account of the band on a correctly signed request', async () => {
    const { i, mint } = issuer()
    expect(await i.issue(await request())).toEqual({ username: 'stageboard-band-a-host~stage-pc', password: 'secret' })
    expect(mint).toHaveBeenCalledWith('band-a', 'stage-pc')
  })

  it('refuses a request signed with another code, unsigned, or from a host the band does not list', async () => {
    const { i, mint } = issuer()
    expect(await i.issue(await request({}, await leaseKey('00000000', 'band-a')))).toBeNull()
    expect(await i.issue({ hostId: 'stage-pc', sentAt: 1 })).toBeNull()
    expect(await i.issue(await request({ hostId: 'stranger' }))).toBeNull()
    expect(mint).not.toHaveBeenCalled()
  })

  it('refuses the host asking for itself, and a request when the band lists fewer than two hosts', async () => {
    expect(await issuer('stage-pc').i.issue(await request())).toBeNull()
    expect(await issuer('laptop', [primary]).i.issue(await request())).toBeNull()
    expect(await issuer('laptop', null).i.issue(await request())).toBeNull()
  })

  it('refuses a replayed request: sentAt must rise per host', async () => {
    const { i, mint } = issuer()
    expect(await i.issue(await request({ sentAt: 10 }))).not.toBeNull()
    expect(await i.issue(await request({ sentAt: 10 }))).toBeNull()
    expect(await i.issue(await request({ sentAt: 9 }))).toBeNull()
    expect(await i.issue(await request({ sentAt: 11 }))).not.toBeNull()
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('refuses without a band, and when the account cannot be made', async () => {
    expect(await issuer('laptop', [primary, backup], { workspaceId: () => null }).i.issue(await request())).toBeNull()
    expect(await issuer('laptop', [primary, backup], { mint: vi.fn().mockRejectedValue(new Error('database down')) }).i.issue(await request())).toBeNull()
  })

  it('keeps the highest sentAt where it is told to - a restart does not make a recorded request good again', async () => {
    const seen = new Map<string, number>()
    const sentAt = { get: (hostId: string) => seen.get(hostId), set: (hostId: string, at: number) => void seen.set(hostId, at) }
    expect(await issuer('laptop', [primary, backup], { sentAt }).i.issue(await request({ sentAt: 10 }))).not.toBeNull()
    expect(seen.get('stage-pc')).toBe(10)
    expect(await issuer('laptop', [primary, backup], { sentAt }).i.issue(await request({ sentAt: 10 }))).toBeNull() // a new instance, same record
  })
})

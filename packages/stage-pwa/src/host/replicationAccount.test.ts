import { describe, expect, it } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { createHostLogin } from 'sync-host'
import { createAccountIssuer } from './replicationAccount'
import { leaseKey, signAccountRequest } from './leaseAuth'

const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }
const backup: BandHostEntry = { hostId: 'tablet', url: 'https://10.0.0.2:8443', priority: 2 }

async function issuer(hosts: BandHostEntry[] = [primary, backup]) {
  const key = await leaseKey('57832943', 'band')
  const issuer = createAccountIssuer({ selfHostId: 'tablet', workspaceId: 'band', hosts: () => hosts, key: async () => key, load: () => null, save: () => undefined })
  return { issuer, key }
}

describe('login for the returned primary (#947)', () => {
  it('hands the other listed host a login the tablet then accepts', async () => {
    const { issuer: i, key } = await issuer()
    const account = await i.issue(await signAccountRequest({ hostId: 'laptop', sentAt: 5 }, key))
    expect(account?.username).toBe('stageboard-band-host~laptop')
    const login = createHostLogin({ accounts: async () => i.accounts() })
    const basic = `Basic ${btoa(`${account!.username}:${account!.password}`)}`
    expect(await login(basic, 'stageboard-band')).toEqual({ name: account!.username, roles: ['member'] })
    expect(await login(`Basic ${btoa(`${account!.username}:wrong`)}`, 'stageboard-band')).toBeNull()
  })

  it('refuses a replayed request, a stranger, itself and a wrong code', async () => {
    const { issuer: i, key } = await issuer()
    const ok = await signAccountRequest({ hostId: 'laptop', sentAt: 5 }, key)
    expect(await i.issue(ok)).not.toBeNull()
    expect(await i.issue(ok)).toBeNull()
    expect(await i.issue(await signAccountRequest({ hostId: 'stranger', sentAt: 9 }, key))).toBeNull()
    expect(await i.issue(await signAccountRequest({ hostId: 'tablet', sentAt: 9 }, key))).toBeNull()
    expect(await i.issue(await signAccountRequest({ hostId: 'laptop', sentAt: 9 }, await leaseKey('11111111', 'band')))).toBeNull()
    expect(await i.issue({ nonsense: true })).toBeNull()
  })

  it('issues nothing while the band lists only one host', async () => {
    const { issuer: i, key } = await issuer([backup])
    expect(await i.issue(await signAccountRequest({ hostId: 'laptop', sentAt: 5 }, key))).toBeNull()
  })
})

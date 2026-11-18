import { describe, expect, it, vi } from 'vitest'
import type { SyncRequest } from 'sync-host'
import { answerHostRequest, bandOfPath, type AppHostDeps } from './hostHttp'

const baseDeps = () => {
  const seen: SyncRequest[] = []
  const deps: AppHostDeps = {
    hostId: 'tablet-1',
    port: 8443,
    address: '10.0.0.2',
    certFingerprint: 'b'.repeat(64),
    bandTime: () => 1_700_000_000_123,
    state: () => ({ epoch: 2, active: false, outdated: false, priority: 2 }),
    activeWorkspaceId: () => null,
    lease: () => ({ hostId: 'laptop', epoch: 1, alive: true, silentForMs: 200 }),
    acceptLease: vi.fn(async () => 'accepted' as const),
    verifyBandCode: vi.fn(async (workspaceId: string, code: string) => workspaceId === 'leasetest' && code === '57832943'),
    issueAccount: vi.fn(async () => ({ username: 'u', password: 'p' })),
    acceptInvite: vi.fn(async () => ({ ok: true as const })),
    sync: vi.fn(async (_ctx, request) => {
      seen.push(request)
      return { status: 200, body: { answered: true } }
    }),
    login: vi.fn(async (authorization) => (authorization === 'Basic good' ? { name: 'device', roles: ['member', 'admin'] } : null)),
  }
  return { deps, seen }
}

describe('what a passive backup answers (#947)', () => {
  it('tells who it is and which epoch it serves', async () => {
    const { deps } = baseDeps()
    expect(await answerHostRequest({ method: 'GET', path: '/time', query: {} }, deps)).toEqual({
      status: 200,
      body: { serverTime: 1_700_000_000_123, hostId: 'tablet-1', epoch: 2, active: false },
    })
    expect(await answerHostRequest({ method: 'GET', path: '/server-info', query: {} }, deps)).toEqual({
      status: 200,
      body: { lanIp: '10.0.0.2', port: 8443, hostname: 'stageboard.local', certFingerprint: 'b'.repeat(64) },
    })
  })

  it('serves no band: active workspace null and every database request refused', async () => {
    const { deps } = baseDeps()
    expect(await answerHostRequest({ method: 'GET', path: '/server/active-workspace', query: {} }, deps)).toEqual({
      status: 200,
      body: { activeWorkspaceId: null },
    })
    const refused = await answerHostRequest({ method: 'POST', path: '/db/stageboard-leasetest/_bulk_docs', query: {}, authorization: 'Basic good', body: { docs: [] } }, deps)
    expect(refused.status).toBe(503)
    expect(deps.login).not.toHaveBeenCalled()
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('takes a lease from the primary and reports its epoch', async () => {
    const { deps } = baseDeps()
    const signed = { lease: { hostId: 'laptop', epoch: 1, leaseMs: 4_000, sentAt: 1 }, sig: 'ab' }
    const answer = await answerHostRequest({ method: 'POST', path: '/host/lease', query: {}, body: signed }, deps)
    expect(deps.acceptLease).toHaveBeenCalledWith(signed)
    expect(answer).toEqual({ status: 200, body: { accepted: true, epoch: 2, active: false } })
  })

  it('accepts the primary\'s band invite for itself', async () => {
    const { deps } = baseDeps()
    const invite = { workspaceId: 'leasetest', accessCode: '57832943', primaryUrl: 'https://10.0.0.1:8443', targetHostId: 'tablet-1', sentAt: 5 }
    expect((await answerHostRequest({ method: 'POST', path: '/host/join-band-invite', query: {}, body: invite }, deps)).status).toBe(200)
    expect(deps.acceptInvite).toHaveBeenCalledWith(invite)
  })

  it('turns an invite that is not for this host into the handler\'s refusal', async () => {
    const { deps } = baseDeps()
    deps.acceptInvite = vi.fn(async () => ({ ok: false as const, status: 400, message: 'This invite is for another host' }))
    expect(await answerHostRequest({ method: 'POST', path: '/host/join-band-invite', query: {}, body: {} }, deps)).toEqual({
      status: 400,
      body: { status: 'error', message: 'This invite is for another host' },
    })
  })

  it('hands the returned primary a login, or 403', async () => {
    const { deps } = baseDeps()
    expect(await answerHostRequest({ method: 'POST', path: '/host/replication-account', query: {}, body: {} }, deps)).toEqual({ status: 200, body: { username: 'u', password: 'p' } })
    deps.issueAccount = vi.fn(async () => null)
    expect((await answerHostRequest({ method: 'POST', path: '/host/replication-account', query: {}, body: {} }, deps)).status).toBe(403)
  })

  it('confirms the band code only while it is the host', async () => {
    const { deps } = baseDeps()
    const ask = (code: string) => answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/roster', query: {}, body: { code } }, deps)
    expect((await ask('57832943')).status).toBe(403) // passive backup
    deps.state = () => ({ epoch: 2, active: true, priority: 1, outdated: false })
    expect((await ask('57832943')).status).toBe(200)
    expect((await ask('00000000')).status).toBe(403)
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/roster', query: {} }, deps)).status).toBe(403)
  })

  it('answers unknown routes with 404', async () => {
    const { deps } = baseDeps()
    expect((await answerHostRequest({ method: 'GET', path: '/plugins/whatever', query: {} }, deps)).status).toBe(404)
  })
})

describe('when it has taken over (#947)', () => {
  it('serves the band to a logged-in device, with the write rules in front', async () => {
    const { deps, seen } = baseDeps()
    deps.state = () => ({ epoch: 3, active: true, outdated: false, priority: 2 })
    deps.activeWorkspaceId = () => 'leasetest'
    expect((await answerHostRequest({ method: 'GET', path: '/server/active-workspace', query: {} }, deps)).body).toEqual({ activeWorkspaceId: 'leasetest' })
    const answer = await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: { since: '4' }, authorization: 'Basic good' }, deps)
    expect(answer).toEqual({ status: 200, body: { answered: true } })
    expect(deps.login).toHaveBeenCalledWith('Basic good', 'stageboard-leasetest')
    expect(seen[0]).toEqual({ method: 'GET', path: '/stageboard-leasetest/_changes', query: { since: '4' }, body: undefined })
  })

  it('refuses a device that is not of this band', async () => {
    const { deps } = baseDeps()
    deps.state = () => ({ epoch: 3, active: true, outdated: false, priority: 2 })
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: {}, authorization: 'Basic bad' }, deps)).status).toBe(401)
    expect(deps.sync).not.toHaveBeenCalled()
  })
})

describe('bandOfPath', () => {
  it('strips the /db proxy prefix a device uses', () => {
    expect(bandOfPath('/db/stageboard-leasetest/_changes')).toEqual({ db: 'stageboard-leasetest', inner: '/stageboard-leasetest/_changes' })
    expect(bandOfPath('/stageboard-leasetest/hosts%3Aabc')).toEqual({ db: 'stageboard-leasetest', inner: '/stageboard-leasetest/hosts%3Aabc' })
  })
  it('refuses a database name the app does not hold', () => {
    expect(bandOfPath('/db/other/_all_docs')).toBeNull()
    expect(bandOfPath('/')).toBeNull()
  })
})

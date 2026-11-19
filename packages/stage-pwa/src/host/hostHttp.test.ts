import { describe, expect, it, vi } from 'vitest'
import { createBandAccounts, createBandJoin, createPinThrottle, type AccountDoc, type SyncRequest } from 'sync-host'
import { answerHostRequest, bandOfPath, loginCheckOf, type AppHostDeps } from './hostHttp'

/** The routes every host shares are tested once, in sync-host (routes.test.ts); here: the tablet's own, and its wiring of the shared ones. */
const baseDeps = () => {
  const seen: SyncRequest[] = []
  const files = new Map<string, Uint8Array>()
  const deps: AppHostDeps = {
    hostId: 'tablet-1',
    port: 8443,
    address: '10.0.0.2',
    certFingerprint: 'b'.repeat(64),
    state: () => ({ epoch: 2, active: false, outdated: false, priority: 2 }),
    lease: {
      bandTime: () => 1_700_000_000_123,
      epoch: () => 2,
      isBandHost: () => false,
      isActive: () => false,
      outdated: () => false,
      status: () => ({ hostId: 'laptop', epoch: 1, alive: true, silentForMs: 200 }),
      clockOffsetMs: () => null,
      receive: vi.fn(async () => 'accepted' as const),
    },
    activeWorkspaceId: () => 'leasetest',
    acceptInvite: vi.fn(async () => ({ ok: true as const })),
    audio: {
      get: vi.fn(async (v: string, t: string) => files.get(`${v}/${t}`) ?? null),
      put: vi.fn(async (v: string, t: string, data: Uint8Array) => void files.set(`${v}/${t}`, data)),
      remove: vi.fn(async () => undefined),
    },
    presence: { report: vi.fn(() => true), heartbeat: vi.fn(() => true) },
    verifyBandCode: vi.fn(async (workspaceId: string, code: string) => workspaceId === 'leasetest' && code === '57832943'),
    issueAccount: vi.fn(async () => ({ username: 'u', password: 'p' })),
    sync: vi.fn(async (_ctx, request) => {
      seen.push(request)
      return { status: 200, body: { answered: true } }
    }),
    login: vi.fn(async (authorization) => (authorization === 'Basic good' ? { name: 'device', roles: ['member', 'admin'] } : null)),
  }
  return { deps, seen }
}
const active = (deps: AppHostDeps) => {
  deps.state = () => ({ epoch: 3, active: true, outdated: false, priority: 1 })
  return deps
}

describe('what a passive backup answers (#947)', () => {
  it('tells who it is through the shared routes, and its own address on /server-info', async () => {
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

  it('refuses every database request, before it asks who is calling', async () => {
    const { deps } = baseDeps()
    const refused = await answerHostRequest({ method: 'POST', path: '/db/stageboard-leasetest/_bulk_docs', query: {}, authorization: 'Basic good', body: { docs: [] } }, deps)
    expect(refused.status).toBe(503)
    expect(deps.login).not.toHaveBeenCalled()
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('refuses the shared routes that need the band (audio, presence) with 503, but takes the lease and the invitation', async () => {
    const { deps } = baseDeps()
    expect((await answerHostRequest({ method: 'GET', path: '/audio/var1/trk1', query: {} }, deps)).status).toBe(503)
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/master-heartbeat', query: {}, body: { deviceId: 'fire' } }, deps)).status).toBe(503)
    expect((await answerHostRequest({ method: 'POST', path: '/host/lease', query: {}, body: {} }, deps)).status).toBe(200)
    expect((await answerHostRequest({ method: 'POST', path: '/host/join-band-invite', query: {}, body: {} }, deps)).status).toBe(200)
  })

  it('names the band it holds, also while passive - the primary must not invite it again', async () => {
    const { deps } = baseDeps()
    expect((await answerHostRequest({ method: 'GET', path: '/server/active-workspace', query: {} }, deps)).body).toEqual({ activeWorkspaceId: 'leasetest' })
  })

  it('confirms the band code only while it is the host', async () => {
    const { deps } = baseDeps()
    const ask = (code: string) => answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/roster', query: {}, body: { code } }, deps)
    expect((await ask('57832943')).status).toBe(403) // passive backup
    active(deps)
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
    active(deps)
    const answer = await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: { since: '4' }, authorization: 'Basic good' }, deps)
    expect(answer).toEqual({ status: 200, body: { answered: true } })
    expect(deps.login).toHaveBeenCalledWith('Basic good', 'stageboard-leasetest')
    expect(seen[0]).toEqual({ method: 'GET', path: '/stageboard-leasetest/_changes', query: { since: '4' }, body: undefined })
  })

  it('refuses a device that is not of this band', async () => {
    const { deps } = baseDeps()
    active(deps)
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: {}, authorization: 'Basic bad' }, deps)).status).toBe(401)
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('takes an upload from the native server as bytes and hands the track back', async () => {
    const { deps } = baseDeps()
    active(deps)
    const bytes = new Uint8Array([1, 2, 3, 250])
    expect(await answerHostRequest({ method: 'PUT', path: '/audio/var1/trk1', query: {}, body: { data: bytes, contentType: 'audio/wav' } }, deps)).toEqual({ status: 204, body: null })
    const got = await answerHostRequest({ method: 'GET', path: '/audio/var1/trk1', query: {} }, deps)
    expect(got).toEqual({ status: 200, body: null, binary: { data: bytes, contentType: 'application/octet-stream' } })
  })

  it('records presence for its own band only', async () => {
    const { deps } = baseDeps()
    active(deps)
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/master-heartbeat', query: {}, body: { deviceId: 'fire' } }, deps)).status).toBe(204)
    expect(deps.presence.heartbeat).toHaveBeenCalledWith('leasetest', 'fire')
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

describe('loginCheckOf', () => {
  it('names the band database the native server asks about before it relays a live channel', () => {
    expect(loginCheckOf('/_host-login/stageboard-leasetest')).toBe('stageboard-leasetest')
    expect(loginCheckOf('/_host-login/stageboard-a%20b')).toBe('stageboard-a b')
  })
  it('refuses anything that is not a band database', () => {
    expect(loginCheckOf('/_host-login/other')).toBeNull()
    expect(loginCheckOf('/_host-login/stageboard-x/extra')).toBeNull()
    expect(loginCheckOf('/db/stageboard-x')).toBeNull()
  })

  it('lets a device join the band through the tablet - the same answers as the Stage-Server - once it is the host', async () => {
    const { deps } = baseDeps()
    const docs = new Map<string, AccountDoc>()
    const accounts = createBandAccounts({ workspaceId: 'leasetest', iterations: 1000, store: { get: async (id) => docs.get(id) ?? null, put: async (d) => void docs.set(d._id, d), list: async (p) => [...docs.values()].filter((d) => d._id.startsWith(p)) } })
    const joinBand = createBandJoin({ accounts, throttle: createPinThrottle(), workspaceId: 'leasetest', accessCode: async () => '57832943', profile: async (id) => (id === 'p1' ? { stageRoles: ['admin'] } : null) })
    deps.joinBand = (band) => (band === 'leasetest' ? joinBand : null)
    const join = (code: string) => answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/join/p1', query: {}, body: { code, password: '4711', deviceId: 'fire' } }, deps)
    expect((await join('57832943')).status).toBe(503)
    active(deps)
    expect((await join('00000000')).status).toBe(403)
    const joined = await join('57832943')
    expect(joined.status).toBe(201)
    expect(joined.body).toMatchObject({ username: 'stageboard-leasetest-p1~fire', isAdmin: true })
  })
})

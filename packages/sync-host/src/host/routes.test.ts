import { describe, expect, it, vi } from 'vitest'
import { createBandAccounts } from './bandAccounts.js'
import { createBandJoin } from './bandJoin.js'
import { createPinThrottle } from './pinThrottle.js'
import { createHostRoutes, matchHostRoute, type HostAudio, type HostRoutesDeps, type HostRouteResponse } from './routes.js'

function audioStub(): HostAudio & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    get: vi.fn(async (v: string, t: string) => files.get(`${v}/${t}`) ?? null),
    put: vi.fn(async (v: string, t: string, data: Uint8Array) => void files.set(`${v}/${t}`, data)),
    remove: vi.fn(async (v: string, t: string) => void files.delete(`${v}/${t}`)),
  }
}

function deps(over: Partial<HostRoutesDeps> = {}): HostRoutesDeps & { audio: ReturnType<typeof audioStub> } {
  return {
    hostId: 'tablet-1',
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
    issueAccount: vi.fn(async () => ({ username: 'u', password: 'p' })),
    audio: audioStub(),
    presence: { report: vi.fn(() => true), heartbeat: vi.fn(() => true) },
    ...over,
  } as HostRoutesDeps & { audio: ReturnType<typeof audioStub> }
}

/** Dispatches like both platforms do: match the table, hand over the params. */
async function call(d: HostRoutesDeps, method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<HostRouteResponse | null> {
  const routes = createHostRoutes(d)
  const hit = matchHostRoute(routes, method, path)
  return hit ? hit.route.handle({ method, path, params: hit.params, query, body }) : null
}

describe('the route table', () => {
  it('matches by method and pattern, hands over the params, and knows nothing else', () => {
    const routes = createHostRoutes(deps())
    expect(matchHostRoute(routes, 'POST', '/workspaces/leasetest/master-heartbeat')?.params).toEqual({ workspaceId: 'leasetest' })
    expect(matchHostRoute(routes, 'GET', '/audio/v1/t1')?.params).toEqual({ variantId: 'v1', trackId: 't1' })
    expect(matchHostRoute(routes, 'GET', '/workspaces/leasetest/master-heartbeat')).toBeNull()
    expect(matchHostRoute(routes, 'GET', '/plugins/x')).toBeNull()
    expect(matchHostRoute(routes, 'GET', '/time/')?.route.pattern).toBe('/time')
  })

  it('every route has a Fastify-style pattern, so an adapter can register it as it is', () => {
    for (const r of createHostRoutes(deps())) expect(r.pattern).toMatch(/^\/[a-zA-Z0-9/:_-]+$/)
  })
})

describe('who the host is', () => {
  it('/time tells the band time, who it is, which epoch and whether it is the band host', async () => {
    expect(await call(deps(), 'GET', '/time')).toEqual({ status: 200, body: { serverTime: 1_700_000_000_123, hostId: 'tablet-1', epoch: 2, active: false } })
  })

  it('/server/active-workspace names the band the host is set up for - also as a passive backup (a fresh one says null)', async () => {
    expect(await call(deps(), 'GET', '/server/active-workspace')).toEqual({ status: 200, body: { activeWorkspaceId: 'leasetest' } })
    expect((await call(deps({ activeWorkspaceId: () => null }), 'GET', '/server/active-workspace'))?.body).toEqual({ activeWorkspaceId: null })
  })

  it('/server/host-lease reports the lease and the role, plus whatever the platform adds', async () => {
    const d = deps({ hostLeaseExtra: () => ({ replication: { state: 'caught-up' } }) })
    expect(await call(d, 'GET', '/server/host-lease')).toEqual({
      status: 200,
      body: { lease: { hostId: 'laptop', epoch: 1, alive: true, silentForMs: 200 }, clockOffsetMs: null, active: false, epoch: 2, outdated: false, replication: { state: 'caught-up' } },
    })
  })
})

describe('the alive signal and the band invitation', () => {
  it('takes a lease and answers with whether it counted and the host\'s own epoch and role', async () => {
    const d = deps()
    const signed = { lease: { hostId: 'laptop', epoch: 1, leaseMs: 4_000, sentAt: 1 }, sig: 'ab' }
    expect(await call(d, 'POST', '/host/lease', signed)).toEqual({ status: 200, body: { accepted: true, epoch: 2, active: false } })
    expect(d.lease.receive).toHaveBeenCalledWith(signed)
  })

  it('accepts the primary\'s band invite, or turns the refusal into its status', async () => {
    const d = deps()
    const invite = { workspaceId: 'leasetest', accessCode: '57832943', primaryUrl: 'https://10.0.0.1:8443', targetHostId: 'tablet-1', sentAt: 5 }
    expect(await call(d, 'POST', '/host/join-band-invite', invite)).toEqual({ status: 200, body: { status: 'ok' } })
    expect(d.acceptInvite).toHaveBeenCalledWith(invite)
    d.acceptInvite = vi.fn(async () => ({ ok: false as const, status: 400, message: 'This invite is for another host' }))
    expect(await call(d, 'POST', '/host/join-band-invite', {})).toEqual({ status: 400, body: { status: 'error', message: 'This invite is for another host' } })
  })

  it('hands the returned primary a login, or an empty 403', async () => {
    const d = deps()
    expect(await call(d, 'POST', '/host/replication-account', {})).toEqual({ status: 200, body: { username: 'u', password: 'p' } })
    d.issueAccount = vi.fn(async () => null)
    expect(await call(d, 'POST', '/host/replication-account', {})).toEqual({ status: 403, body: {} })
  })
})

describe('audio', () => {
  it('stores an upload and hands it back as bytes', async () => {
    const d = deps()
    const bytes = new Uint8Array([1, 2, 3, 250])
    expect(await call(d, 'PUT', '/audio/var1/trk1', bytes)).toEqual({ status: 204 })
    const got = await call(d, 'GET', '/audio/var1/trk1')
    expect(got).toEqual({ status: 200, binary: { data: bytes, contentType: 'application/octet-stream' } })
  })

  it('answers 404 for a track it does not hold, and deletes one', async () => {
    const d = deps()
    expect((await call(d, 'GET', '/audio/var1/none'))?.status).toBe(404)
    await call(d, 'PUT', '/audio/v/t', new Uint8Array([9]))
    expect(await call(d, 'DELETE', '/audio/v/t')).toEqual({ status: 204 })
    expect((await call(d, 'GET', '/audio/v/t'))?.status).toBe(404)
  })

  it('refuses ids that could leave the store, before it touches the store', async () => {
    const d = deps()
    for (const path of ['/audio/..%2Fx/t', '/audio/v/a%2Fb', '/audio/v%00/t', '/audio/%E0%A4%A/t']) {
      expect((await call(d, 'GET', path))?.status).toBe(400)
    }
    expect(d.audio.get).not.toHaveBeenCalled()
  })

  it('takes an upload only as bytes', async () => {
    const d = deps()
    expect((await call(d, 'PUT', '/audio/v/t', { text: 'no' }))?.status).toBe(400)
    expect(d.audio.put).not.toHaveBeenCalled()
  })

  it('is refused with 503 while the host does not serve the band - and open when the platform says it serves', async () => {
    const passive = deps({ serving: () => false })
    expect((await call(passive, 'GET', '/audio/v/t'))?.status).toBe(503)
    expect((await call(passive, 'POST', '/workspaces/leasetest/master-heartbeat', { deviceId: 'fire' }))?.status).toBe(503)
    expect((await call(deps(), 'GET', '/audio/v/t'))?.status).toBe(404) // no `serving`: always open, as the Stage-Server was
  })
})

describe('presence and the master\'s heartbeat', () => {
  it('records a report and a beat for the band, as 204', async () => {
    const d = deps()
    expect(await call(d, 'POST', '/workspaces/leasetest/presence/report', { deviceId: 'fire', profileId: 'p1' })).toEqual({ status: 204 })
    expect(d.presence.report).toHaveBeenCalledWith('leasetest', { deviceId: 'fire', profileId: 'p1' })
    expect(await call(d, 'POST', '/workspaces/leasetest/master-heartbeat', { deviceId: 'fire' })).toEqual({ status: 204 })
    expect(d.presence.heartbeat).toHaveBeenCalledWith('leasetest', 'fire')
  })

  it('answers 400 with the first problem when the body is no report or beat', async () => {
    const d = deps()
    const bad = await call(d, 'POST', '/workspaces/leasetest/presence/report', { deviceId: 'fire' })
    expect(bad?.status).toBe(400)
    expect(bad?.body).toMatchObject({ status: 'error' })
    expect((await call(d, 'POST', '/workspaces/leasetest/master-heartbeat', {}))?.status).toBe(400)
    expect(d.presence.report).not.toHaveBeenCalled()
  })

  it('answers 404 for a band that is not the host\'s', async () => {
    const d = deps({ presence: { report: vi.fn(() => false), heartbeat: vi.fn(() => false) } })
    expect((await call(d, 'POST', '/workspaces/other/master-heartbeat', { deviceId: 'fire' }))?.status).toBe(404)
  })
})

describe('joining and the admin PIN', () => {
  const memberDeps = (over: Partial<HostRoutesDeps> = {}) => {
    const docs = new Map<string, Record<string, unknown> & { _id: string }>()
    const accounts = createBandAccounts({
      workspaceId: 'leasetest',
      iterations: 1000,
      store: { get: async (id) => docs.get(id) ?? null, put: async (d) => void docs.set(d._id, d), list: async (p) => [...docs.values()].filter((d) => d._id.startsWith(p)) },
    })
    const join = createBandJoin({ accounts, throttle: createPinThrottle(), workspaceId: 'leasetest', accessCode: async () => '57832943', profile: async (id) => (id === 'p1' ? { stageRoles: ['admin'] } : id === 'p2' ? {} : null) })
    return deps({ joinBand: (ws) => (ws === 'leasetest' ? join : null), ...over })
  }

  it('lets a device join with the band code and answers with its own login', async () => {
    const r = await call(memberDeps(), 'POST', '/workspaces/leasetest/join/p2', { code: '57832943', deviceId: 'fire' })
    expect(r?.status).toBe(201)
    expect(r?.body).toMatchObject({ username: 'stageboard-leasetest-p2~fire', isAdmin: false })
  })

  it('answers 400 for a body that does not fit, and 403 (not 404) for a band it does not hold', async () => {
    expect((await call(memberDeps(), 'POST', '/workspaces/leasetest/join/p2', { deviceId: 'fire' }))?.status).toBe(400)
    expect((await call(memberDeps(), 'POST', '/workspaces/other/join/p2', { code: '57832943', deviceId: 'fire' }))?.status).toBe(403)
  })

  it('checks an admin PIN: the first join chooses it, the check answers 200 or 403, 429 with the header after too many', async () => {
    const d = memberDeps()
    await call(d, 'POST', '/workspaces/leasetest/join/p1', { code: '57832943', password: '4711', deviceId: 'fire' })
    expect((await call(d, 'POST', '/workspaces/leasetest/verify-admin-pin', { profileId: 'p1', pin: '4711' }))?.status).toBe(200)
    for (let i = 0; i < 5; i++) await call(d, 'POST', '/workspaces/leasetest/verify-admin-pin', { profileId: 'p1', pin: '0000' })
    const locked = await call(d, 'POST', '/workspaces/leasetest/verify-admin-pin', { profileId: 'p1', pin: '4711' })
    expect(locked?.status).toBe(429)
    expect(locked?.headers).toEqual({ 'Retry-After': '300' })
  })

  it('is refused with 503 while passive, and not there at all on a host without members', async () => {
    expect((await call(memberDeps({ serving: () => false }), 'POST', '/workspaces/leasetest/join/p2', { code: '57832943', deviceId: 'x' }))?.status).toBe(503)
    expect(await call(deps(), 'POST', '/workspaces/leasetest/join/p2', { code: '57832943', deviceId: 'x' })).toBeNull()
  })
})

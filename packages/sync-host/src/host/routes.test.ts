import { describe, expect, it, vi } from 'vitest'
import { createBandAccounts } from './bandAccounts.js'
import { createBandJoin } from './bandJoin.js'
import { createBandMembers } from './bandMembers.js'
import { createPinThrottle } from './pinThrottle.js'
import { createHostDeviceInfo } from './deviceInfo.js'
import { createHostPresence } from './presence.js'
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
    presence: createHostPresence({ now: () => 9_000, newId: () => 'flash-1' }),
    deviceInfo: createHostDeviceInfo({ now: () => 9_000 }),
    band: {
      accessCode: async (ws: string) => (ws === 'leasetest' ? { code: '57832943', name: 'Lease Test' } : null),
      profileDocs: async () => [{ _id: 'profiles:p1', id: 'p1', name: 'Test', stageRoles: ['admin'] }, { _id: 'profiles:p2', id: 'p2', name: 'Zed' }],
    },
    isBandDevice: vi.fn(async (_ws: string, authorization: string | undefined) => authorization === 'Basic good'),
    ...over,
  } as HostRoutesDeps & { audio: ReturnType<typeof audioStub> }
}

/** Dispatches like both platforms do: match the table, hand over the params. */
async function call(d: HostRoutesDeps, method: string, path: string, body?: unknown, query: Record<string, string> = {}, authorization?: string, remoteAddress?: string): Promise<HostRouteResponse | null> {
  const routes = createHostRoutes(d)
  const hit = matchHostRoute(routes, method, path)
  return hit ? hit.route.handle({ method, path, params: hit.params, query, body, ...(authorization ? { authorization } : {}), ...(remoteAddress ? { remoteAddress } : {}) }) : null
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

describe('what the host can do (#962)', () => {
  const capabilities = { kind: 'android' as const, platform: 'android', arch: 'arm64', database: 'builtin' as const, jobs: [{ id: 'backup', available: false, needs: 'a Node machine' }], plugins: [] }

  it('/host/capabilities tells what this device can do, on every host', async () => {
    expect(await call(deps({ capabilities: () => capabilities }), 'GET', '/host/capabilities')).toEqual({ status: 200, body: capabilities })
    expect(matchHostRoute(createHostRoutes(deps()), 'GET', '/host/capabilities')).toBeNull()
  })

  it('/health is the alive signal of any host', async () => {
    expect(await call(deps(), 'GET', '/health')).toEqual({ status: 200, body: { status: 'ok' } })
  })

  it('/server/active-workspace/admins names only the admins of the band the host is set up for', async () => {
    expect(await call(deps(), 'GET', '/server/active-workspace/admins')).toEqual({ status: 200, body: { workspaceId: 'leasetest', admins: [{ profileId: 'p1', name: 'Test' }] } })
    expect((await call(deps({ activeWorkspaceId: () => null }), 'GET', '/server/active-workspace/admins'))?.status).toBe(404)
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

describe('presence, the master\'s heartbeat, the Ready Check and flash messages', () => {
  it('records a report and a beat for the band, as 204', async () => {
    const d = deps()
    expect(await call(d, 'POST', '/workspaces/leasetest/presence/report', { deviceId: 'fire', profileId: 'p1' })).toEqual({ status: 204 })
    expect(await call(d, 'POST', '/workspaces/leasetest/master-heartbeat', { deviceId: 'fire' })).toEqual({ status: 204 })
    expect(d.presence.snapshot('leasetest')).toEqual({ devices: { fire: { profileId: 'p1', lastSeenAt: 9_000 } }, masterHeartbeat: { deviceId: 'fire', at: 9_000 } })
  })

  it('records a Ready Check answer', async () => {
    const d = deps()
    expect(await call(d, 'POST', '/workspaces/leasetest/ready-check/report', { checkId: 'c1', profileId: 'anna' })).toEqual({ status: 204 })
    expect(d.presence.snapshot('leasetest').readyCheck).toEqual({ checkId: 'c1', readyProfileIds: ['anna'] })
  })

  it('answers 400 with the first problem when the body is no report, beat or answer', async () => {
    const d = deps()
    const bad = await call(d, 'POST', '/workspaces/leasetest/presence/report', { deviceId: 'fire' })
    expect(bad?.status).toBe(400)
    expect(bad?.body).toMatchObject({ status: 'error' })
    expect((await call(d, 'POST', '/workspaces/leasetest/master-heartbeat', {}))?.status).toBe(400)
    expect((await call(d, 'POST', '/workspaces/leasetest/ready-check/report', { checkId: 'c1' }))?.status).toBe(400)
    expect(d.presence.snapshot('leasetest')).toEqual({ devices: {} })
  })

  it('answers 404 for a band that is not the host\'s, when the platform serves only one', async () => {
    const d = deps({ servesBand: (ws) => ws === 'leasetest' })
    expect((await call(d, 'POST', '/workspaces/other/master-heartbeat', { deviceId: 'fire' }))?.status).toBe(404)
    expect((await call(d, 'POST', '/workspaces/other/ready-check/report', { checkId: 'c', profileId: 'p' }))?.status).toBe(404)
    expect((await call(d, 'POST', '/workspaces/leasetest/master-heartbeat', { deviceId: 'fire' }))?.status).toBe(204)
  })

  it('sends a flash message for a device of the band only - nothing is stored without the login', async () => {
    const d = deps()
    const body = { text: 'Pause 10 min', from: 'Anna' }
    expect((await call(d, 'POST', '/workspaces/leasetest/flash', body))?.status).toBe(401)
    expect((await call(d, 'POST', '/workspaces/leasetest/flash', body, {}, 'Basic bad'))?.status).toBe(401)
    expect(d.presence.snapshot('leasetest').flash).toBeUndefined()
    const sent = await call(d, 'POST', '/workspaces/leasetest/flash', body, {}, 'Basic good')
    expect(sent).toEqual({ status: 201, body: { id: 'flash-1', text: 'Pause 10 min', from: 'Anna', at: 9_000 } })
    expect(d.presence.snapshot('leasetest').flash).toEqual(sent?.body)
    expect(d.isBandDevice).toHaveBeenCalledWith('leasetest', 'Basic good')
  })

  it('refuses a flash message that is no message with 400, whoever sends it', async () => {
    const d = deps()
    expect((await call(d, 'POST', '/workspaces/leasetest/flash', { text: '' }, {}, 'Basic good'))?.status).toBe(400)
    expect((await call(d, 'POST', '/workspaces/leasetest/flash', { text: 'x'.repeat(121) }))?.status).toBe(400)
  })

  it('is refused with 503 while the host does not serve the band', async () => {
    const d = deps({ serving: () => false })
    expect((await call(d, 'POST', '/workspaces/leasetest/master-heartbeat', { deviceId: 'fire' }))?.status).toBe(503)
    expect((await call(d, 'POST', '/workspaces/leasetest/flash', { text: 'x' }, {}, 'Basic good'))?.status).toBe(503)
  })
})

describe('the Device Ledger', () => {
  const report = { deviceId: 'fire', os: 'Fire', environment: 'native', syncStatus: 'idle' }

  it('takes a device\'s report, stamped with the address it came from, and lists it', async () => {
    const d = deps()
    expect(await call(d, 'POST', '/workspaces/leasetest/device-info/report', report, {}, undefined, '192.168.178.179')).toEqual({ status: 204 })
    const list = await call(d, 'GET', '/workspaces/leasetest/device-info')
    expect(list?.status).toBe(200)
    expect((list?.body as { devices: Record<string, { ip: string; os: string; lastSeenAt: number }> }).devices.fire).toMatchObject({ ip: '192.168.178.179', os: 'Fire', lastSeenAt: 9_000 })
    expect(list?.body).toHaveProperty('collectingSince', 9_000)
  })

  it('answers 400 with the first problem for a report that does not fit, and stores nothing', async () => {
    const d = deps()
    const bad = await call(d, 'POST', '/workspaces/leasetest/device-info/report', { deviceId: 'fire', os: 'Fire', environment: 'toaster', syncStatus: 'idle' })
    expect(bad?.status).toBe(400)
    expect(bad?.body).toMatchObject({ status: 'error' })
    expect(d.deviceInfo.snapshot('leasetest').devices).toEqual({})
  })

  it('is refused with 503 while passive and 404 for a band that is not the host\'s', async () => {
    expect((await call(deps({ serving: () => false }), 'GET', '/workspaces/leasetest/device-info'))?.status).toBe(503)
    expect((await call(deps({ serving: () => false }), 'POST', '/workspaces/leasetest/device-info/report', report))?.status).toBe(503)
    const one = deps({ servesBand: (ws) => ws === 'leasetest' })
    expect((await call(one, 'GET', '/workspaces/other/device-info'))?.status).toBe(404)
    expect((await call(one, 'POST', '/workspaces/other/device-info/report', report))?.status).toBe(404)
  })
})

describe('the roster', () => {
  const ask = (d: HostRoutesDeps, ws: string, body: unknown) => call(d, 'POST', `/workspaces/${ws}/roster`, body)

  it('hands a device that knows the band\'s code the list to pick from, with the band\'s name', async () => {
    expect(await ask(deps(), 'leasetest', { code: '57832943' })).toEqual({
      status: 200,
      body: { workspaceId: 'leasetest', workspaceName: 'Lease Test', members: [{ profileId: 'p1', name: 'Test', isAdmin: true }, { profileId: 'p2', name: 'Zed', isAdmin: false }] },
    })
  })

  it('answers 403 for a wrong code and shows nothing', async () => {
    expect(await ask(deps(), 'leasetest', { code: '00000000' })).toEqual({ status: 403, body: { status: 'error', message: 'Wrong code' } })
  })

  it('answers 400 for a body without a code, and 403 for a band it does not hold (it must not say which exist)', async () => {
    expect((await ask(deps(), 'leasetest', {}))?.status).toBe(400)
    expect((await ask(deps(), 'unknown-band', { code: '57832943' }))?.status).toBe(403)
  })

  it('is refused with 503 while the host does not serve the band', async () => {
    expect((await ask(deps({ serving: () => false }), 'leasetest', { code: '57832943' }))?.status).toBe(503)
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

describe('managing members', () => {
  const setup = async (over: Partial<HostRoutesDeps> = {}) => {
    const docs = new Map<string, Record<string, unknown> & { _id: string }>()
    const accounts = createBandAccounts({
      workspaceId: 'leasetest',
      iterations: 1000,
      store: { get: async (id) => (docs.get(id) as never) ?? null, put: async (d) => void docs.set(d._id, d as never), list: async (p) => [...docs.values()].filter((d) => d._id.startsWith(p)) as never },
    })
    const profiles: Record<string, { stageRoles?: string[] }> = { p1: { stageRoles: ['admin'] }, p2: {}, p3: { stageRoles: ['admin'] } }
    const base = { accounts, throttle: createPinThrottle(), workspaceId: 'leasetest', accessCode: async () => '57832943', profile: async (id: string) => profiles[id] ?? null }
    const join = createBandJoin(base)
    const members = createBandMembers({ ...base, join, loginThrottle: createPinThrottle(), adminProfileIds: async () => Object.keys(profiles).filter((id) => profiles[id]!.stageRoles?.includes('admin')) })
    const d = deps({ joinBand: (ws) => (ws === 'leasetest' ? join : null), members: (ws) => (ws === 'leasetest' ? members : null), ...over })
    const made = (await call(d, 'POST', '/workspaces/leasetest/join/p1', { code: '57832943', password: '4711', deviceId: 'fire' }))?.body as { username: string; password: string }
    return { d, admin: { adminUsername: made.username, adminPassword: made.password }, made }
  }

  it('adds a member, gives and takes admin, removes - each answered like the Stage-Server', async () => {
    const { d, admin } = await setup()
    expect((await call(d, 'POST', '/workspaces/leasetest/members', { ...admin, profileId: 'p3', isAdmin: true, password: '1234' }))?.body).toEqual({ username: 'stageboard-leasetest-p3', password: '1234' })
    expect((await call(d, 'POST', '/workspaces/leasetest/members/p2/admin', { ...admin, isAdmin: true }))?.status).toBe(204)
    expect((await call(d, 'DELETE', '/workspaces/leasetest/members/p2', admin))?.status).toBe(204)
  })

  it('answers 400 for a body that does not fit, 403 for someone who is no admin, 503 while passive, nothing without members', async () => {
    const { d, admin } = await setup()
    expect((await call(d, 'POST', '/workspaces/leasetest/members', { profileId: 'p2' }))?.status).toBe(400)
    expect((await call(d, 'POST', '/workspaces/leasetest/members', { adminUsername: admin.adminUsername, adminPassword: 'wrong', profileId: 'p2' }))?.status).toBe(403)
    let up = true
    const passiveHost = await setup({ serving: () => up })
    up = false
    expect((await call(passiveHost.d, 'POST', '/workspaces/leasetest/members/p2/reset-password', passiveHost.admin))?.status).toBe(503)
    expect(await call(deps(), 'POST', '/workspaces/leasetest/members', { ...admin, profileId: 'p2' })).toBeNull()
  })

  it('resets a PIN, sets one\'s own, and lets a device take on another person', async () => {
    const { d, admin, made } = await setup()
    const reset = await call(d, 'POST', '/workspaces/leasetest/members/p3/reset-password', admin)
    expect(reset?.status).toBe(200)
    expect((reset?.body as { password: string }).password).toMatch(/^\d{4}$/)
    const own = await call(d, 'POST', '/workspaces/leasetest/members/p1/set-pin', { callerUsername: made.username, callerPassword: made.password, newPin: '9999', deviceId: 'fire' })
    expect(own?.status).toBe(200)
    const again = own?.body as { username: string; password: string }
    expect((await call(d, 'POST', '/workspaces/leasetest/members/p2/activate', { callerUsername: again.username, callerPassword: again.password, deviceId: 'fire' }))?.status).toBe(201)
  })

  it('answers a band it does not hold like a wrong login (403)', async () => {
    const { d, admin } = await setup()
    expect((await call(d, 'POST', '/workspaces/other/members', { ...admin, profileId: 'p2' }))?.status).toBe(403)
  })
})

describe('the band life cycle in the shared table (#962)', () => {
  const catalog = (over: Partial<Record<string, (...a: never[]) => unknown>> = {}) =>
    ({
      create: vi.fn(async () => ({ status: 201, body: { username: 'u', password: 'p' } })),
      list: vi.fn(async () => ({ status: 200, body: [{ workspaceId: 'band', workspaceName: 'Band' }] })),
      remove: vi.fn(async () => ({ status: 204 })),
      accessCode: vi.fn(async () => ({ status: 200, body: { code: '12345678' } })),
      rotateAccessCode: vi.fn(async () => ({ status: 200, body: { code: '87654321' } })),
      rename: vi.fn(async () => ({ status: 200, body: { status: 'ok' } })),
      setMasterMode: vi.fn(async () => ({ status: 200, body: { status: 'ok' } })),
      revokeDevice: vi.fn(async () => ({ status: 204 })),
      forgetDevice: vi.fn(async () => ({ status: 404, body: { status: 'error', message: 'Unknown device' } })),
      ...over,
    }) as never

  it('answers founding, listing, deleting, renaming, the code and the master mode on every host that has a catalog', async () => {
    const bands = catalog()
    const d = deps({ bands })
    expect((await call(d, 'POST', '/workspaces', { workspaceId: 'band', founderId: 'p1', workspaceName: 'Band', deviceId: 'tablet' }, {}, undefined, '10.0.0.9'))?.status).toBe(201)
    expect(bands.create).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'band' }), '10.0.0.9')
    expect((await call(d, 'GET', '/workspaces'))?.body).toEqual([{ workspaceId: 'band', workspaceName: 'Band' }])
    expect((await call(d, 'DELETE', '/workspaces/band', { adminUsername: 'a', adminPassword: 'b' }))?.status).toBe(204)
    expect((await call(d, 'POST', '/workspaces/band/name', { name: 'Neu', adminUsername: 'a', adminPassword: 'b' }))?.status).toBe(200)
    expect((await call(d, 'POST', '/workspaces/band/access-code', { adminUsername: 'a', adminPassword: 'b' }))?.body).toEqual({ code: '12345678' })
    expect((await call(d, 'POST', '/workspaces/band/access-code/rotate', { adminUsername: 'a', adminPassword: 'b' }))?.body).toEqual({ code: '87654321' })
    expect((await call(d, 'POST', '/workspaces/band/master-mode', { masterMode: 'account', adminUsername: 'a', adminPassword: 'b' }))?.status).toBe(200)
    expect((await call(d, 'POST', '/workspaces/band/devices/fire/revoke', { revoked: true, adminUsername: 'a', adminPassword: 'b' }))?.status).toBe(204)
    expect((await call(d, 'POST', '/workspaces/band/devices/fire/forget', { adminUsername: 'a', adminPassword: 'b' }))?.status).toBe(404)
  })

  it('checks the body before anything else, and says 400 for a founding without an id', async () => {
    const bands = catalog()
    const d = deps({ bands })
    expect((await call(d, 'POST', '/workspaces', { founderId: 'p1', workspaceName: 'Band' }))?.status).toBe(400)
    expect(bands.create).not.toHaveBeenCalled()
  })

  it('is absent where the host has no catalog, so a host that answers none of it keeps its table', async () => {
    expect(matchHostRoute(createHostRoutes(deps()), 'GET', '/workspaces')).toBeNull()
  })
})

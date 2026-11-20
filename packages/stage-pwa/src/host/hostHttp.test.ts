import { describe, expect, it, vi } from 'vitest'
import { createBandAccounts, createBandJoin, createHostChannels, createBandMembers, createPinThrottle, createHostDeviceInfo, createHostPresence, type AccountDoc, type SyncRequest } from 'sync-host'
import { createTabletCapabilities } from './tabletCapabilities'
import { answerHostRequest, bandOfPath, isClosedConnection, loginCheckOf, type AppHostDeps } from './hostHttp'

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
    presence: createHostPresence({ now: () => 5_000, newId: () => 'flash-1' }),
    deviceInfo: createHostDeviceInfo({ now: () => 5_000 }),
    servesBand: (band: string) => band === 'leasetest',
    isBandDevice: async (_band: string, authorization: string | undefined) => authorization === 'Basic good',
    band: {
      accessCode: async (band: string) => (band === 'leasetest' ? { code: '57832943', name: 'Lease Test' } : null),
      profileDocs: async () => [{ _id: 'profiles:p1', id: 'p1', name: 'Test', stageRoles: ['admin'] }],
    },
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

  it('hands a joining device the real roster once it has the band\'s code - a passive backup shows nothing (503)', async () => {
    const { deps } = baseDeps()
    const ask = (code: string) => answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/roster', query: {}, body: { code } }, deps)
    expect((await ask('57832943')).status).toBe(503)
    active(deps)
    expect(await ask('57832943')).toEqual({ status: 200, body: { workspaceId: 'leasetest', workspaceName: 'Lease Test', members: [{ profileId: 'p1', name: 'Test', isAdmin: true }] } })
    expect((await ask('00000000')).status).toBe(403)
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/roster', query: {} }, deps)).status).toBe(400)
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

  it('takes a Ready Check answer and a flash message from a device of the band - both used to be 404 on the tablet', async () => {
    const { deps } = baseDeps()
    active(deps)
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/ready-check/report', query: {}, body: { checkId: 'c1', profileId: 'anna' } }, deps)).status).toBe(204)
    expect(deps.presence.snapshot('leasetest').readyCheck).toEqual({ checkId: 'c1', readyProfileIds: ['anna'] })
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/flash', query: {}, body: { text: 'Pause' } }, deps)).status).toBe(401)
    const sent = await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/flash', query: {}, authorization: 'Basic good', body: { text: 'Pause', from: 'Anna' } }, deps)
    expect(sent.status).toBe(201)
    expect(deps.presence.snapshot('leasetest').flash).toMatchObject({ text: 'Pause', from: 'Anna' })
  })

  it('takes a device report with the address the native server saw, and lists it - the Device Ledger used to be 404 on the tablet', async () => {
    const { deps } = baseDeps()
    active(deps)
    const report = { deviceId: 'fire', os: 'Fire', environment: 'native', syncStatus: 'idle' }
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/device-info/report', query: {}, remoteAddress: '192.168.178.179', body: report }, deps)).status).toBe(204)
    const list = await answerHostRequest({ method: 'GET', path: '/workspaces/leasetest/device-info', query: {} }, deps)
    expect((list.body as { devices: Record<string, { ip: string }> }).devices.fire!.ip).toBe('192.168.178.179')
  })

  it('records presence for its own band only', async () => {
    const { deps } = baseDeps()
    active(deps)
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/master-heartbeat', query: {}, body: { deviceId: 'fire' } }, deps)).status).toBe(204)
    expect(deps.presence.snapshot('leasetest').masterHeartbeat).toEqual({ deviceId: 'fire', at: 5_000 })
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/other/master-heartbeat', query: {}, body: { deviceId: 'fire' } }, deps)).status).toBe(404)
  })
})

describe('several bands on one tablet (#962)', () => {
  const several = () => {
    const { deps, seen } = baseDeps()
    const hosted = new Set(['leasetest', 'founded'])
    // The band the lease makes this tablet host of, and a band it founded itself while another band became active.
    deps.servesBand = (band: string) => hosted.has(band)
    deps.serving = (band?: string) => band === 'founded'
    return { deps, seen }
  }

  it('serves a band it founded even while the active band is passive - a band it only knows as a device is 404', async () => {
    const { deps } = several()
    const founded = await answerHostRequest({ method: 'GET', path: '/db/stageboard-founded/_changes', query: {}, authorization: 'Basic good' }, deps)
    expect(founded.status).toBe(200)
    expect(deps.login).toHaveBeenCalledWith('Basic good', 'stageboard-founded')
    // The active band still follows the lease: passive means 503, not "served because it is active".
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: {}, authorization: 'Basic good' }, deps)).status).toBe(503)
    // A band this tablet merely joined is not its business - 404, before the login asks anything.
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-joined/_changes', query: {}, authorization: 'Basic good' }, deps)).status).toBe(404)
    expect(deps.sync).toHaveBeenCalledTimes(1)
  })

  it('takes a presence report and a roster call for a served band, and refuses them for a band it does not host', async () => {
    const { deps } = several()
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/founded/master-heartbeat', query: {}, body: { deviceId: 'fire' } }, deps)).status).toBe(204)
    expect(deps.presence.snapshot('founded').masterHeartbeat).toEqual({ deviceId: 'fire', at: 5_000 })
    expect((await answerHostRequest({ method: 'POST', path: '/workspaces/joined/master-heartbeat', query: {}, body: { deviceId: 'fire' } }, deps)).status).toBe(404)
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

  it('lets a device join the band through the tablet - the same answers as the Host - once it is the host', async () => {
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

  it('lets an admin add a member through the tablet - body and answer like the Host - once it is the host', async () => {
    const { deps } = baseDeps()
    const docs = new Map<string, AccountDoc>()
    const accounts = createBandAccounts({ workspaceId: 'leasetest', iterations: 1000, store: { get: async (id) => docs.get(id) ?? null, put: async (d) => void docs.set(d._id, d), list: async (p) => [...docs.values()].filter((d) => d._id.startsWith(p)) } })
    const base = { accounts, throttle: createPinThrottle(), workspaceId: 'leasetest', accessCode: async () => '57832943', profile: async (id: string) => (id === 'p1' ? { stageRoles: ['admin'] } : {}) }
    const join = createBandJoin(base)
    deps.joinBand = () => join
    deps.members = () => createBandMembers({ ...base, join, loginThrottle: createPinThrottle(), adminProfileIds: async () => ['p1'] })
    active(deps)
    const made = (await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/join/p1', query: {}, body: { code: '57832943', password: '4711', deviceId: 'fire' } }, deps)).body as { username: string; password: string }
    const add = await answerHostRequest({ method: 'POST', path: '/workspaces/leasetest/members', query: {}, body: { adminUsername: made.username, adminPassword: made.password, profileId: 'p2' } }, deps)
    expect(add.status).toBe(201)
    const removed = await answerHostRequest({ method: 'DELETE', path: '/workspaces/leasetest/members/p2', query: {}, body: { adminUsername: made.username, adminPassword: made.password } }, deps)
    expect(removed.status).toBe(204)
  })
})

describe('live channels on the tablet (#962)', () => {
  it('feeds a channel through the shared routes, and answers a stream it does not relay with 501 and the missing capability - never 404', async () => {
    const { deps } = baseDeps()
    deps.channels = createHostChannels({ presence: deps.presence, readBandDocs: async () => [] })
    deps.servesBand = () => true
    deps.serving = () => true
    deps.isBandDevice = async () => true
    const seen: unknown[] = []
    deps.channels.subscribe('plugin-health', 'leasetest', (snapshot) => seen.push(snapshot))
    expect((await answerHostRequest({ method: 'POST', path: '/plugin-health/leasetest/report', query: {}, body: { pluginName: 'midi', status: 'online' } }, deps)).status).toBe(204)
    expect(seen).toHaveLength(2)
    const stream = await answerHostRequest({ method: 'GET', path: '/workspaces/leasetest/discovery/stream', query: {} }, deps)
    expect(stream.status).toBe(501)
    expect(stream.body).toMatchObject({ error: 'capability_missing', capability: 'live-stream:discovery' })
  })
})

describe('what the tablet cannot do (#962)', () => {
  it('tells its capabilities, and refuses a job it cannot do with 501 and what it lacks - never 404', async () => {
    const { deps } = baseDeps()
    deps.capabilities = () => createTabletCapabilities({ platform: 'android', cpuCores: 8 })
    const caps = await answerHostRequest({ method: 'GET', path: '/host/capabilities', query: {} }, deps)
    expect(caps.status).toBe(200)
    expect(caps.body).toMatchObject({ kind: 'android', cpuCores: 8 })
    for (const [method, path, capability] of [
      ['POST', '/server/backup/run', 'backup'],
      ['GET', '/speech', 'speech'],
      ['GET', '/lookup/ug/search', 'lookup'],
      ['POST', '/plugins/stem-separation/trigger', 'plugin:stem-separation'],
      ['POST', '/workspaces/leasetest/activate-hardware', 'hardware'],
    ] as const) {
      const refused = await answerHostRequest({ method, path, query: {} }, deps)
      expect(refused.status, path).toBe(501)
      expect(refused.body, path).toMatchObject({ error: 'capability_missing', capability })
    }
  })
})

describe('isClosedConnection (#962)', () => {
  it('recognises the answer of a database handle whose connection the browser closed', () => {
    const closed = { status: 500, body: { error: "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", status: 500 } }
    expect(isClosedConnection(closed)).toBe(true)
    expect(isClosedConnection({ status: 500, body: 'InvalidStateError: the database connection is closed' })).toBe(true)
  })

  it('is false for every other answer - a real error must not be retried', () => {
    expect(isClosedConnection({ status: 200, body: { error: 'InvalidStateError: connection is closing' } })).toBe(false)
    expect(isClosedConnection({ status: 500, body: { error: 'QuotaExceededError' } })).toBe(false)
    expect(isClosedConnection({ status: 500, body: null })).toBe(false)
  })
})

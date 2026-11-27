import { describe, expect, it, vi } from 'vitest'
import { createBandAccounts } from './bandAccounts.js'
import { createBandJoin } from './bandJoin.js'
import { createHostChannels } from './channels/index.js'
import { createBandMembers } from './bandMembers.js'
import { createPinThrottle } from './pinThrottle.js'
import { createHostDeviceInfo } from './deviceInfo.js'
import { createHostPresence } from './presence.js'
import type { AccountDoc } from './bandAccounts.js'
import type { SyncRequest } from '../index.js'
import { answerHostRequest, bandOfPath, loginCheckOf, type HostRequestDeps } from './hostRequest.js'

/** A device login of `band` as a device sends it; the test login accepts the password `pw`. */
const dev = (band: string, password = 'pw') => `Basic ${Buffer.from(`stageboard-${band}-p1~dev:${password}`).toString('base64')}`

/** The routes every host shares are tested once (routes.test.ts); here: the request handler every platform uses (#964) - the band guard and the answers a device that cannot do a thing gets. */
const baseDeps = () => {
  const seen: SyncRequest[] = []
  const files = new Map<string, Uint8Array>()
  const deps: HostRequestDeps = {
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
    login: vi.fn(async (authorization) => (authorization === 'Basic good' || (authorization !== undefined && authorization.startsWith('Basic ') && Buffer.from(authorization.slice(6), 'base64').toString().endsWith(':pw')) ? { name: 'device', roles: ['member', 'admin'] } : null)),
  }
  return { deps, seen }
}
const active = (deps: HostRequestDeps) => {
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
    expect(await answerHostRequest({ method: 'GET', path: '/host/info', query: {} }, deps)).toEqual({
      status: 200,
      body: { lanIp: '10.0.0.2', port: 8443, hostname: 'stageboard.local', certFingerprint: 'b'.repeat(64) },
    })
  })

  it('refuses every database request, before it asks who is calling', async () => {
    const { deps } = baseDeps()
    const refused = await answerHostRequest({ method: 'POST', path: '/db/stageboard-leasetest/_bulk_docs', query: {}, authorization: dev('leasetest'), body: { docs: [] } }, deps)
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
    const answer = await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: { since: '4' }, authorization: dev('leasetest') }, deps)
    expect(answer).toEqual({ status: 200, body: { answered: true } })
    expect(deps.login).toHaveBeenCalledWith(dev('leasetest'), 'stageboard-leasetest')
    expect(seen[0]).toEqual({ method: 'GET', path: '/stageboard-leasetest/_changes', query: { since: '4' }, body: undefined })
  })

  it('refuses a device that is not of this band', async () => {
    const { deps } = baseDeps()
    active(deps)
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: {}, authorization: dev('leasetest', 'wrong') }, deps)).status).toBe(401)
    expect(deps.sync).not.toHaveBeenCalled()
  })

  it('refuses another band\'s login with 403 and locks a login after wrong passwords like the laptop (429, #396)', async () => {
    const { deps } = baseDeps()
    active(deps)
    deps.loginThrottle = createPinThrottle({ maxFailures: 2 })
    const ask = (authorization: string) => answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: {}, authorization }, deps)
    expect((await ask(dev('other'))).status).toBe(403)
    expect((await ask(dev('leasetest', 'wrong'))).status).toBe(401)
    expect((await ask(dev('leasetest', 'wrong'))).status).toBe(401)
    // Locked: even the right password waits now.
    expect(await ask(dev('leasetest'))).toMatchObject({ status: 429, body: { error: 'locked' } })
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
    const founded = await answerHostRequest({ method: 'GET', path: '/db/stageboard-founded/_changes', query: {}, authorization: dev('founded') }, deps)
    expect(founded.status).toBe(200)
    expect(deps.login).toHaveBeenCalledWith(dev('founded'), 'stageboard-founded')
    // The active band still follows the lease: passive means 503, not "served because it is active".
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/_changes', query: {}, authorization: dev('leasetest') }, deps)).status).toBe(503)
    // A band this tablet merely joined is not its business - 404, before the login asks anything.
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-joined/_changes', query: {}, authorization: dev('joined') }, deps)).status).toBe(404)
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

describe('a device that cannot do a job, through the handler (#964)', () => {
  it('tells its capabilities, and answers a job it cannot do with 501 and what it lacks - never 404', async () => {
    const { deps } = baseDeps()
    const lacking = { id: 'x', available: false, needs: 'a desktop machine' }
    deps.capabilities = () => ({ kind: 'android', platform: 'android', arch: 'arm64', database: 'builtin', cpuCores: 8, jobs: ['backup', 'speech', 'lookup', 'hardware'].map((id) => ({ ...lacking, id })), plugins: [{ ...lacking, id: 'stem-separation' }] })
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

describe('a Node host answers through the same pipeline (#964 step 2)', () => {
  const nodeDeps = () => {
    const { deps } = baseDeps()
    const database = vi.fn(async () => ({ status: 200, body: { db: true } }))
    const node: HostRequestDeps = {
      ...deps,
      serving: () => true,
      state: () => ({ epoch: 1, active: true, outdated: false, priority: null }),
      ownRoutes: [
        { method: 'GET', pattern: '/host/:anything', handle: async () => ({ status: 200, body: { param: true } }) },
        { method: 'GET', pattern: '/host/own', handle: async () => ({ status: 200, body: { own: true }, headers: { 'X-Own': '1' } }) },
      ],
      stream: (path) => (path === '/workspaces/leasetest/show-state/stream' ? () => () => undefined : null),
      database,
    }
    delete node.login
    delete node.sync
    return { deps: node, database }
  }

  it('matches its own routes, the more literal pattern first, and keeps their headers; a HEAD is answered as the GET', async () => {
    const { deps } = nodeDeps()
    expect(await answerHostRequest({ method: 'GET', path: '/host/own', query: {} }, deps)).toEqual({ status: 200, body: { own: true }, headers: { 'X-Own': '1' } })
    expect((await answerHostRequest({ method: 'GET', path: '/host/else', query: {} }, deps)).body).toEqual({ param: true })
    expect((await answerHostRequest({ method: 'HEAD', path: '/host/own', query: {} }, deps)).status).toBe(200)
  })

  it('hands a stream it relays to the transport instead of refusing it', async () => {
    const { deps } = nodeDeps()
    const relayed = await answerHostRequest({ method: 'GET', path: '/workspaces/leasetest/show-state/stream', query: {} }, deps)
    expect(relayed.status).toBe(200)
    expect(typeof relayed.stream).toBe('function')
    expect((await answerHostRequest({ method: 'GET', path: '/workspaces/leasetest/presence/stream', query: {} }, deps)).status).toBe(501)
  })

  it('hands `/db` to a database with its own logins, behind the guard, and leaves other paths alone', async () => {
    const { deps, database } = nodeDeps()
    deps.loginThrottle = createPinThrottle({ maxFailures: 1 })
    expect(await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/', query: { a: '1' }, authorization: dev('leasetest') }, deps)).toEqual({ status: 200, body: { db: true } })
    expect(database).toHaveBeenLastCalledWith({ method: 'GET', path: '/stageboard-leasetest/', query: { a: '1' }, body: undefined, authorization: dev('leasetest') })
    expect((await answerHostRequest({ method: 'GET', path: '/db/_session', query: {} }, deps)).status).toBe(200)
    expect((await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/', query: {}, authorization: dev('other') }, deps)).status).toBe(403)
    // Without `/db` a Node host has no band database.
    expect((await answerHostRequest({ method: 'GET', path: '/stageboard-leasetest/_changes', query: {}, authorization: dev('leasetest') }, deps)).status).toBe(404)
    // The database's own 401 counts towards the lock, and the lock carries Retry-After.
    database.mockResolvedValueOnce({ status: 401, body: { db: false } })
    await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/', query: {}, authorization: dev('leasetest', 'wrong') }, deps)
    const locked = await answerHostRequest({ method: 'GET', path: '/db/stageboard-leasetest/', query: {}, authorization: dev('leasetest', 'wrong') }, deps)
    expect(locked.status).toBe(429)
    expect(locked.headers?.['Retry-After']).toMatch(/^\d+$/)
  })
})

import { pbkdf2Sync } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as showStatePushHub from './showStatePushHub.js'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, Server as HttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { ILookupPlugin, IShowControlPlugin, PluginContext } from 'shared-types'

// The activate-hardware route (below) reaches real createPluginSync/createMidiWatcher through
// workspaceHardwareController.ts - mocked here so activating a workspace in a test never tries
// real the database network calls or real MIDI port enumeration on whatever machine runs the suite.
vi.mock('./plugins/pluginSync.js', () => ({
  createPluginSync: vi.fn(() => ({ stop: vi.fn(), syncOnce: vi.fn(), writeHeartbeat: vi.fn() })),
}))
vi.mock('./midiWatcher.js', () => ({
  createMidiWatcher: vi.fn(() => ({ stop: vi.fn() })),
}))
import {
  __resetDeviceInfoStoreForTests,
  getSnapshot as getDeviceInfoSnapshot,
  setEntry as setDeviceInfoEntry,
} from './deviceInfoStore.js'
import {
  __resetDiscoverySessionStoreForTests,
  getSnapshot as getDiscoverySnapshot,
} from './discoverySessionStore.js'
import { bandDbProxyRefusal, buildApp } from './index.js'
import { LookupError } from './plugins/lookupError.js'
import { __resetHealthStoreForTests, getSnapshot, setEntry } from './plugins/healthStore.js'
import {
  __resetPresenceStoreForTests,
  getSnapshot as getPresenceSnapshot,
  setEntry as setPresenceEntry,
} from './presenceStore.js'
import { recordDeletedWorkspace } from './provisioningAuth.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

function fakeShowControlPlugin(overrides: Partial<IShowControlPlugin> = {}): IShowControlPlugin {
  return {
    name: 'fake-mixer',
    version: '0.0.1',
    capabilities: [],
    init: vi.fn(),
    trigger: vi.fn(async () => ({ status: 'ok' as const, data: { volume: 5 } })),
    ...overrides,
  }
}

function fakeLookupPlugin(overrides: Partial<ILookupPlugin> = {}): ILookupPlugin {
  return {
    name: 'fake-lookup',
    version: '0.0.1',
    capabilities: [],
    init: vi.fn(),
    search: vi.fn(async (query: string) => [{ id: '1', title: `Result for ${query}` }]),
    fetchDetail: vi.fn(async (resultId: string) => ({ chordProContent: `content for ${resultId}` })),
    ...overrides,
  }
}

/** A device login of a band as the band's database returns it - what a login on the admin routes is checked against
 * (#960). The password every test sends for a good login is `correct-pw`. */
function accountDoc(name: string, roles: string[], password = 'correct-pw') {
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  return { _id: `account:${name}`, _rev: '1-a', name, roles, iterations: 1000, salt, derived_key: pbkdf2Sync(password, salt, 1000, 32, 'sha256').toString('hex'), pbkdf2_prf: 'sha256' }
}

describe('/db proxy - a band database only for that band\'s accounts', () => {
  const basic = (username: string) => `Basic ${Buffer.from(`${username}:pw`).toString('base64')}`

  it('lets an account of the band into its own database', () => {
    expect(bandDbProxyRefusal('/db/stageboard-band-a/_changes?since=0', basic('stageboard-band-a-p1~dev'))).toBeNull()
    expect(bandDbProxyRefusal('/db/stageboard-band-a', basic('stageboard-band-a-p1'))).toBeNull()
  })

  it('refuses another band\'s account and requests without a login', () => {
    expect(bandDbProxyRefusal('/db/stageboard-band-a/_all_docs', basic('stageboard-band-b-p1'))).toBe('account of another band')
    expect(bandDbProxyRefusal('/db/stageboard-band-a/_all_docs', undefined)).toBe('no band login')
    expect(bandDbProxyRefusal('/db//stageboard-band-a/x', basic('stageboard-band-b-p1'))).toBe('account of another band')
    expect(bandDbProxyRefusal('/db/%73tageboard-band-a/x', basic('stageboard-band-b-p1'))).toBe('account of another band')
    expect(bandDbProxyRefusal('/db/../stageboard-band-a', basic('stageboard-band-b-p1'))).toBe('bad path')
    expect(bandDbProxyRefusal('/db/stageboard-band-a%2Fx', basic('stageboard-band-b-p1'))).toBe('bad path')
  })

  it('leaves the database\'s own endpoints to the database', () => {
    expect(bandDbProxyRefusal('/db/_session', undefined)).toBeNull()
    expect(bandDbProxyRefusal('/db/', undefined)).toBeNull()
  })
})

describe('Fastify routes', () => {
  let app: FastifyInstance
  let registry: Awaited<ReturnType<typeof buildApp>>['registry']
  let lookupRegistry: Awaited<ReturnType<typeof buildApp>>['lookupRegistry']

  beforeEach(async () => {
    ;({ app, registry, lookupRegistry } = await buildApp())
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /health', () => {
    it('returns ok', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok' })
    })
  })

  describe('GET /time', () => {
    it('returns the server clock, close to Date.now()', async () => {
      const before = Date.now()
      const response = await app.inject({ method: 'GET', url: '/time' })
      const after = Date.now()

      expect(response.statusCode).toBe(200)
      const { serverTime } = response.json() as { serverTime: number }
      expect(serverTime).toBeGreaterThanOrEqual(before)
      expect(serverTime).toBeLessThanOrEqual(after)
    })

    it('announces the epoch it was started with, from STAGEBOARD_HOST_EPOCH', async () => {
      process.env.STAGEBOARD_HOST_EPOCH = '3'
      const { app: other } = await buildApp()
      try {
        const { epoch } = (await other.inject({ method: 'GET', url: '/time' })).json() as { epoch: number }
        expect(epoch).toBe(3)
      } finally {
        delete process.env.STAGEBOARD_HOST_EPOCH
        await other.close()
      }
    })

    it('says it is the band host now - a host with no host list is (#938)', async () => {
      const { active } = (await app.inject({ method: 'GET', url: '/time' })).json() as { active: boolean }
      expect(active).toBe(true)
    })

    it('also announces which host answers and its epoch (#910)', async () => {
      const response = await app.inject({ method: 'GET', url: '/time' })
      const { hostId, epoch } = response.json() as { hostId: string; epoch: number }
      expect(hostId.length).toBeGreaterThan(0)
      expect(epoch).toBe(1)
    })
  })

  describe('host lease routes (#918)', () => {
    it('GET /server/host-lease is null while no lease has arrived', async () => {
      const response = await app.inject({ method: 'GET', url: '/server/host-lease' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ lease: null, clockOffsetMs: null, active: false, epoch: 1 })
    })

    it('POST /host/lease ignores what is not a signed lease, without an error', async () => {
      for (const payload of [{}, { lease: { hostId: 'x' }, sig: 'zz' }, 'nonsense']) {
        const response = await app.inject({ method: 'POST', url: '/host/lease', payload: payload as object })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ accepted: false, epoch: 1, active: false })
      }
    })
  })

  describe('POST /host/join-band-invite (#945)', () => {
    it('refuses an invite that is not for this host, or that is not an invite at all', async () => {
      const bad = await app.inject({
        method: 'POST', url: '/host/join-band-invite',
        payload: { workspaceId: 'band-a', accessCode: '12345678', primaryUrl: 'https://10.0.0.1:8443', targetHostId: 'another', sentAt: 1 },
      })
      expect([400, 502]).toContain(bad.statusCode)
      expect((await app.inject({ method: 'POST', url: '/host/join-band-invite', payload: {} })).statusCode).toBe(400)
    })
  })

  describe('GET /host/look-up (#945)', () => {
    it('needs an https address to ask', async () => {
      expect((await app.inject({ method: 'GET', url: '/host/look-up' })).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: '/host/look-up?address=http://10.0.0.2' })).statusCode).toBe(400)
    })

    it('answers 502 for an address that is not a Stage-Server', async () => {
      // Nothing listens there: the lookup must end, not hang (it answers on connection refusal).
      const response = await app.inject({ method: 'GET', url: '/host/look-up?address=https://127.0.0.1:1' })
      expect(response.statusCode).toBe(502)
    })
  })

  describe('POST /host/join-band (#933)', () => {
    it('is for the host machine itself: a request from another machine is refused and does nothing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/host/join-band',
        remoteAddress: '203.0.113.7',
        payload: { workspaceId: 'band-a', accessCode: '12345678', primaryUrl: 'https://10.0.0.1:8443' },
      })
      expect(response.statusCode).toBe(403)
    })

    it('answers 400 to a request that is not a good one, from the host machine', async () => {
      const response = await app.inject({ method: 'POST', url: '/host/join-band', payload: { workspaceId: 'band-a' } })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /host/take-over and /host/hand-back (#943)', () => {
    for (const path of ['/host/take-over', '/host/hand-back']) {
      it(`${path}: a request without the admin's login is a 400, and nobody else gets in (403)`, async () => {
        expect((await app.inject({ method: 'POST', url: path, payload: {} })).statusCode).toBe(400)
        const refused = await app.inject({ method: 'POST', url: path, payload: { adminUsername: 'stageboard-leasetest-x~y', adminPassword: 'nope' } })
        expect([403, 409]).toContain(refused.statusCode)
      })
    }

    it('says "no band" (409) instead of acting when this host serves none', async () => {
      const response = await app.inject({ method: 'POST', url: '/host/take-over', payload: { adminUsername: 'stageboard-leasetest-x~y', adminPassword: 'nope' } })
      expect(response.statusCode).toBe(409)
    })
  })

  describe('POST /host/replication-account (#919)', () => {
    it('gives nothing to what is not a good signed request - an empty 403, no account', async () => {
      for (const payload of [{}, { request: { hostId: 'x', sentAt: 1 }, sig: 'zz' }, 'nonsense']) {
        const response = await app.inject({ method: 'POST', url: '/host/replication-account', payload: payload as object })
        expect(response.statusCode).toBe(403)
        expect(response.json()).toEqual({})
      }
    })
  })

  describe('GET /server/backup-status (#363)', () => {
    let stateDir: string

    beforeEach(() => {
      stateDir = mkdtempSync(join(tmpdir(), 'stageboard-backup-status-test-'))
      process.env.STAGEBOARD_STATE_DIR = stateDir
    })

    afterEach(() => {
      delete process.env.STAGEBOARD_STATE_DIR
      rmSync(stateDir, { recursive: true, force: true })
    })

    it('answers null while no backup has ever run', async () => {
      const response = await app.inject({ method: 'GET', url: '/server/backup-status' })
      expect(response.statusCode).toBe(200)
      expect(response.body).toBe('null')
    })

    it('passes on what scripts/backup.mjs wrote', async () => {
      writeFileSync(join(stateDir, 'backup-status.json'), JSON.stringify({ ok: false, at: '2026-10-05T04:00:00.000Z', error: 'Ziel nicht da (nicht eingesteckt oder nicht eingehängt): /media/usb' }))
      const response = await app.inject({ method: 'GET', url: '/server/backup-status' })
      expect(response.json()).toMatchObject({ ok: false, error: expect.stringContaining('nicht eingesteckt') })
    })

    it('reports an unreadable status file as a failure instead of crashing', async () => {
      writeFileSync(join(stateDir, 'backup-status.json'), '{ half')
      const response = await app.inject({ method: 'GET', url: '/server/backup-status' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ ok: false })
    })
  })

  describe('POST /server/backup/* (#363)', () => {
    it('refuses without a valid request or without a band active on this server', async () => {
      const bad = await app.inject({ method: 'POST', url: '/server/backup/overview', payload: {} })
      expect(bad.statusCode).toBe(400)
      const noBand = await app.inject({ method: 'POST', url: '/server/backup/save', payload: { adminUsername: 'a', adminPassword: 'b', target: { id: 'x', name: 'X', kind: 'folder', path: '/media/x', keep: 3, dailyAt: null, onPlugIn: true, enabled: true } } })
      expect([403, 409]).toContain(noBand.statusCode)
    })
  })

  describe('latency calibration routes (#491)', () => {
    it('rejects a click count outside 6-24', async () => {
      const response = await app.inject({ method: 'POST', url: '/calibration/runs', payload: { count: 3 } })
      expect(response.statusCode).toBe(400)
    })

    it('answers 404 for an unknown run', async () => {
      const response = await app.inject({ method: 'GET', url: '/calibration/runs/nope' })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('add-ons from repositories (#852)', () => {
    it('serves only plain add-on files, never a path out of the folder', async () => {
      expect((await app.inject({ method: 'GET', url: '/addons/nux-mg30/0.1.0/..%2F..%2Fsecret' })).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: '/addons/nux-mg30/0.1.0/stageboard-addon.json' })).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: '/addons/nux-mg30/9.9.9/client.js' })).statusCode).toBe(404)
    })

    it('preview and install only for an admin of the band', async () => {
      const body = { repository: 'github.com/someone/stageboard-addon-x', expectedVersion: '1.0.0' }
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/addons/preview', payload: body })).statusCode).toBe(403)
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/addons/install', payload: body })).statusCode).toBe(403)
    })
  })

  describe('GET /server-info', () => {
    afterEach(() => {
      delete process.env.LAN_IP
      delete process.env.MDNS_HOSTNAME
    })

    it('reports the port it listens on (#896)', async () => {
      const before = process.env.PORT
      process.env.PORT = '8443'
      try {
        const response = await app.inject({ method: 'GET', url: '/server-info' })
        expect(response.json()).toMatchObject({ port: 8443 })
      } finally {
        if (before === undefined) delete process.env.PORT
        else process.env.PORT = before
      }
    })

    it('reports the LAN_IP override when set', async () => {
      process.env.LAN_IP = '10.1.2.3'
      const response = await app.inject({ method: 'GET', url: '/server-info' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ lanIp: '10.1.2.3' })
    })

    it('falls back to a detected address or null, never throwing, with no LAN_IP set', async () => {
      const response = await app.inject({ method: 'GET', url: '/server-info' })
      expect(response.statusCode).toBe(200)
      const { lanIp } = response.json() as { lanIp: string | null }
      expect(lanIp === null || typeof lanIp === 'string').toBe(true)
    })

    it('defaults hostname to stageboard.local', async () => {
      const response = await app.inject({ method: 'GET', url: '/server-info' })
      expect(response.json()).toMatchObject({ hostname: 'stageboard.local' })
    })

    it('reports the MDNS_HOSTNAME override when set', async () => {
      process.env.MDNS_HOSTNAME = 'my-band.local'
      const response = await app.inject({ method: 'GET', url: '/server-info' })
      expect(response.json()).toMatchObject({ hostname: 'my-band.local' })
    })
  })

  describe('GET /plugins', () => {
    it('lists registered show-control plugins', async () => {
      await registry.register(fakeShowControlPlugin(), testContext())
      const response = await app.inject({ method: 'GET', url: '/plugins' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([{ name: 'fake-mixer', version: '0.0.1', capabilities: [] }])
    })
  })

  describe('POST /plugins/:name/trigger', () => {
    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/plugins/fake-mixer/trigger', payload: {} })
      expect(response.statusCode).toBe(400)
      expect(response.json().status).toBe('error')
    })

    it('returns 404 for an unregistered plugin name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/plugins/unknown/trigger',
        payload: { type: 'set_volume' },
      })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ status: 'error', message: 'Unknown plugin: unknown' })
    })

    it('routes a valid trigger to the matching plugin and returns its result', async () => {
      const trigger = vi.fn(async () => ({ status: 'ok' as const, data: { volume: 7 } }))
      await registry.register(fakeShowControlPlugin({ trigger }), testContext())

      const response = await app.inject({
        method: 'POST',
        url: '/plugins/fake-mixer/trigger',
        payload: { type: 'set_volume', payload: { volume: 7 } },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok', data: { volume: 7 } })
      expect(trigger).toHaveBeenCalledWith({ type: 'set_volume', payload: { volume: 7 } })
    })

    it('fires immediately, with no scheduledAt in the body', async () => {
      const trigger = vi.fn(async () => ({ status: 'ok' as const }))
      await registry.register(fakeShowControlPlugin({ trigger }), testContext())

      const before = Date.now()
      await app.inject({ method: 'POST', url: '/plugins/fake-mixer/trigger', payload: { type: 'flash' } })
      expect(Date.now() - before).toBeLessThan(50)
    })

    it('delays firing until a future scheduledAt, and strips it before calling the plugin', async () => {
      const trigger = vi.fn(async () => ({ status: 'ok' as const }))
      await registry.register(fakeShowControlPlugin({ trigger }), testContext())

      const scheduledAt = Date.now() + 60
      const before = Date.now()
      const response = await app.inject({
        method: 'POST',
        url: '/plugins/fake-mixer/trigger',
        payload: { type: 'flash', scheduledAt },
      })

      expect(response.statusCode).toBe(200)
      expect(Date.now() - before).toBeGreaterThanOrEqual(55)
      expect(trigger).toHaveBeenCalledWith({ type: 'flash' })
    })

    it('fires immediately for a scheduledAt already in the past', async () => {
      const trigger = vi.fn(async () => ({ status: 'ok' as const }))
      await registry.register(fakeShowControlPlugin({ trigger }), testContext())

      const before = Date.now()
      await app.inject({
        method: 'POST',
        url: '/plugins/fake-mixer/trigger',
        payload: { type: 'flash', scheduledAt: Date.now() - 1000 },
      })
      expect(Date.now() - before).toBeLessThan(50)
    })
  })

  describe('GET /lookup/:provider/search', () => {
    it('returns 400 when the query parameter is missing', async () => {
      const response = await app.inject({ method: 'GET', url: '/lookup/fake-lookup/search' })
      expect(response.statusCode).toBe(400)
    })

    it('returns 404 for an unregistered provider', async () => {
      const response = await app.inject({ method: 'GET', url: '/lookup/unknown/search?q=wonderwall' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ status: 'error', message: 'Unknown provider: unknown' })
    })

    it('returns search results from the matching provider', async () => {
      await lookupRegistry.register(fakeLookupPlugin(), testContext())
      const response = await app.inject({ method: 'GET', url: '/lookup/fake-lookup/search?q=wonderwall' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([{ id: '1', title: 'Result for wonderwall' }])
    })

    it('returns 502 when the provider throws', async () => {
      await lookupRegistry.register(
        fakeLookupPlugin({
          search: vi.fn(async () => {
            throw new Error('upstream is down')
          }),
        }),
        testContext(),
      )
      const response = await app.inject({ method: 'GET', url: '/lookup/fake-lookup/search?q=wonderwall' })
      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ status: 'error', code: 'failed', message: 'upstream is down' })
    })

    it("passes a plugin's actionable LookupError on with its code (#15)", async () => {
      await lookupRegistry.register(
        fakeLookupPlugin({
          search: vi.fn(async () => {
            throw new LookupError('blocked', 'Ultimate Guitar hat die Anfrage als Bot blockiert.')
          }),
        }),
        testContext(),
      )
      const response = await app.inject({ method: 'GET', url: '/lookup/fake-lookup/search?q=wonderwall' })
      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ status: 'error', code: 'blocked', message: 'Ultimate Guitar hat die Anfrage als Bot blockiert.' })
    })
  })

  describe('Ultimate Guitar lookup only for a band with its add-on (#546)', () => {
    const ug = () => fakeLookupPlugin({ name: 'ultimate-guitar-scraper' })
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('refuses without a band, and for a band without the add-on - the provider is never asked', async () => {
      const plugin = ug()
      await lookupRegistry.register(plugin, testContext())
      const noBand = await app.inject({ method: 'GET', url: '/lookup/ultimate-guitar-scraper/search?q=wonderwall' })
      expect(noBand.statusCode).toBe(403)
      stubFetch([{ ok: true, status: 200, json: async () => ({ rows: [] }) }])
      const notInstalled = await app.inject({ method: 'GET', url: '/lookup/ultimate-guitar-scraper/detail?resultId=1&workspace=band-a' })
      expect(notInstalled.statusCode).toBe(403)
      expect(notInstalled.json().message).toContain('Ultimate Guitar Import')
      expect(plugin.search).not.toHaveBeenCalled()
      expect(plugin.fetchDetail).not.toHaveBeenCalled()
    })

    it('answers a band that installed it', async () => {
      await lookupRegistry.register(ug(), testContext())
      // By URL, not by order: the band's background watchers poll through the same fetch.
      const installation = { _id: 'plugins:ultimate-guitar-import', id: 'ultimate-guitar-import', name: 'Ultimate Guitar Import', version: '0.0.1', enabled: true, runtime: 'server', installedAt: 1, capabilities: ['chord-import'], transports: [], hardwareIds: [] }
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          String(url).includes('stageboard-band-a/_all_docs')
            ? ({ ok: true, status: 200, json: async () => ({ rows: [{ doc: installation }] }) } as Response)
            : ({ ok: false, status: 404, json: async () => ({}) } as Response),
        ),
      )
      const response = await app.inject({ method: 'GET', url: '/lookup/ultimate-guitar-scraper/search?q=wonderwall&workspace=band-a' })
      expect(response.statusCode).toBe(200)
    })
  })

  describe('YouTube search and thumbnails (#618)', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('search: 400 without a query, 403 without a band or without the add-on', async () => {
      expect((await app.inject({ method: 'GET', url: '/youtube/search?workspace=band-a' })).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', url: '/youtube/search?q=blink' })).statusCode).toBe(403)
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) }) as Response))
      const notInstalled = await app.inject({ method: 'GET', url: '/youtube/search?q=blink&workspace=band-a' })
      expect(notInstalled.statusCode).toBe(403)
      expect(notInstalled.json().message).toContain('YouTube-Download')
    })

    it('thumbnail: only a real video id, fetched through the server', async () => {
      expect((await app.inject({ method: 'GET', url: '/youtube/thumbnail?id=../../etc' })).statusCode).toBe(400)
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as unknown as Response)
      vi.stubGlobal('fetch', fetchMock)
      const response = await app.inject({ method: 'GET', url: '/youtube/thumbnail?id=9Ht5RZpzPqw' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/jpeg')
      expect(fetchMock).toHaveBeenCalledWith('https://i.ytimg.com/vi/9Ht5RZpzPqw/mqdefault.jpg', expect.anything())
    })
  })

  describe('GET /lookup/:provider/detail', () => {
    it('returns 400 when resultId is missing', async () => {
      const response = await app.inject({ method: 'GET', url: '/lookup/fake-lookup/detail' })
      expect(response.statusCode).toBe(400)
    })

    it('returns 404 for an unregistered provider', async () => {
      const response = await app.inject({ method: 'GET', url: '/lookup/unknown/detail?resultId=1' })
      expect(response.statusCode).toBe(404)
    })

    it('returns the detail record from the matching provider', async () => {
      await lookupRegistry.register(fakeLookupPlugin(), testContext())
      const response = await app.inject({ method: 'GET', url: '/lookup/fake-lookup/detail?resultId=result-1' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ chordProContent: 'content for result-1' })
    })
  })

  describe('Audio tracks', () => {
    let storageDir: string

    beforeEach(() => {
      storageDir = mkdtempSync(join(tmpdir(), 'stageboard-audio-test-'))
      process.env.AUDIO_STORAGE_DIR = storageDir
    })

    afterEach(() => {
      delete process.env.AUDIO_STORAGE_DIR
      rmSync(storageDir, { recursive: true, force: true })
    })

    it('round-trips an uploaded track through PUT then GET', async () => {
      const bytes = Buffer.from('fake mp3 bytes')
      const put = await app.inject({
        method: 'PUT',
        url: '/audio/variant-1/track-1',
        headers: { 'content-type': 'audio/mpeg' },
        payload: bytes,
      })
      expect(put.statusCode).toBe(204)

      const get = await app.inject({ method: 'GET', url: '/audio/variant-1/track-1' })
      expect(get.statusCode).toBe(200)
      expect(get.rawPayload).toEqual(bytes)
    })

    it('returns 404 for a track that was never uploaded', async () => {
      const response = await app.inject({ method: 'GET', url: '/audio/variant-1/missing' })
      expect(response.statusCode).toBe(404)
    })

    it('deletes a track, after which GET 404s', async () => {
      await app.inject({
        method: 'PUT',
        url: '/audio/variant-1/track-1',
        headers: { 'content-type': 'audio/mpeg' },
        payload: Buffer.from('bytes'),
      })

      const del = await app.inject({ method: 'DELETE', url: '/audio/variant-1/track-1' })
      expect(del.statusCode).toBe(204)

      const get = await app.inject({ method: 'GET', url: '/audio/variant-1/track-1' })
      expect(get.statusCode).toBe(404)
    })

    it('deleting a track that was never uploaded is a no-op, not an error', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/audio/variant-1/never-uploaded' })
      expect(response.statusCode).toBe(204)
    })

    it('rejects an id containing characters outside the safe filename charset', async () => {
      const response = await app.inject({ method: 'GET', url: '/audio/..%2Fetc/passwd' })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /plugin-health/:workspaceId/report', () => {
    beforeEach(() => {
      __resetHealthStoreForTests()
    })

    it('records the reported status with a server-stamped lastSeenAt', async () => {
      const before = Date.now()
      const response = await app.inject({
        method: 'POST',
        url: '/plugin-health/band-a/report',
        payload: { pluginName: 'generic-webmidi', status: 'online' },
      })

      expect(response.statusCode).toBe(204)
      const entry = getSnapshot('band-a').plugins['generic-webmidi']
      expect(entry.status).toBe('online')
      expect(entry.lastSeenAt).toBeGreaterThanOrEqual(before)
    })

    it('carries an optional message through', async () => {
      await app.inject({
        method: 'POST',
        url: '/plugin-health/band-a/report',
        payload: { pluginName: 'generic-webmidi', status: 'error', message: 'no MIDI device found' },
      })

      expect(getSnapshot('band-a').plugins['generic-webmidi'].message).toBe('no MIDI device found')
    })

    it('rejects a body missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/plugin-health/band-a/report',
        payload: { status: 'online' },
      })
      expect(response.statusCode).toBe(400)
    })

    it('keeps reports scoped to their own workspace', async () => {
      await app.inject({
        method: 'POST',
        url: '/plugin-health/band-a/report',
        payload: { pluginName: 'generic-webmidi', status: 'online' },
      })
      expect(getSnapshot('band-b').plugins['generic-webmidi']).toBeUndefined()
    })
  })

  describe('GET /plugin-health/:workspaceId/stream', () => {
    beforeEach(() => {
      __resetHealthStoreForTests()
    })

    it('streams the current snapshot immediately, then pushes updates as they happen', async () => {
      await app.listen({ port: 0 })
      const address = app.server.address()
      if (typeof address !== 'object' || address === null) throw new Error('server has no address')

      // buildApp() only serves HTTPS when dev certs exist on disk (see index.ts) - present
      // locally (scripts/generate-dev-certs.sh), absent in CI, so this can't assume either
      // protocol and has to ask the actual running server which one it got. With certs, it's an
      // Http2SecureServer (#129's `http2: true`) - node:http2 doesn't export that class as an
      // importable value (only as a type), hence the constructor-name check instead of
      // `instanceof`. `httpsRequest` (Node's default https client, no ALPN 'h2' requested) still
      // works unchanged against it, since `allowHTTP1: true` means a client that doesn't ask for
      // h2 just gets HTTP/1.1. The default FRONTEND_ORIGIN's own scheme tracks the same check,
      // so the origin header below must match too.
      const isHttps = app.server instanceof HttpsServer || app.server.constructor.name === 'Http2SecureServer'
      const request = isHttps ? httpsRequest : httpRequest
      const origin = `${isHttps ? 'https' : 'http'}://localhost:5173`
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/plugin-health/band-a/stream',
          headers: { origin },
          rejectUnauthorized: false,
        },
        () => {},
      )
      req.end()

      const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        req.on('response', resolve)
        req.on('error', reject)
      })

      // CORS headers still apply even though the route bypasses Fastify's normal send path
      // (see index.ts's reply.hijack() comment) - this is the whole reason for copying them.
      expect(res.headers['content-type']).toBe('text/event-stream')
      expect(res.headers['access-control-allow-origin']).toBe(origin)

      const chunks = res[Symbol.asyncIterator]()

      const first = await chunks.next()
      expect(Buffer.from(first.value as Buffer).toString()).toBe('data: {"plugins":{}}\n\n')

      setEntry('band-a', 'mock-mixer', { status: 'online', lastSeenAt: 123 })

      const second = await chunks.next()
      expect(Buffer.from(second.value as Buffer).toString()).toBe(
        `data: ${JSON.stringify({ plugins: { 'mock-mixer': { status: 'online', lastSeenAt: 123 } } })}\n\n`,
      )

      req.destroy()
    })
  })

  describe('POST /workspaces/:workspaceId/presence/report', () => {
    beforeEach(() => {
      __resetPresenceStoreForTests()
    })

    it('records the reported profile with a server-stamped lastSeenAt', async () => {
      const before = Date.now()
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/presence/report',
        payload: { deviceId: 'device-1', profileId: 'p1' },
      })

      expect(response.statusCode).toBe(204)
      const entry = getPresenceSnapshot('band-a').devices['device-1']
      expect(entry.profileId).toBe('p1')
      expect(entry.lastSeenAt).toBeGreaterThanOrEqual(before)
    })

    it('rejects a body missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/presence/report',
        payload: { deviceId: 'device-1' },
      })
      expect(response.statusCode).toBe(400)
    })

    it('keeps reports scoped to their own workspace', async () => {
      await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/presence/report',
        payload: { deviceId: 'device-1', profileId: 'p1' },
      })
      expect(getPresenceSnapshot('band-b').devices['device-1']).toBeUndefined()
    })
  })

  describe('GET /workspaces/:workspaceId/presence/stream', () => {
    beforeEach(() => {
      __resetPresenceStoreForTests()
    })

    it('streams the current snapshot immediately, then pushes updates as they happen', async () => {
      await app.listen({ port: 0 })
      const address = app.server.address()
      if (typeof address !== 'object' || address === null) throw new Error('server has no address')

      // See the plugin-health stream test above for why this isn't a plain `instanceof` check.
      const isHttps = app.server instanceof HttpsServer || app.server.constructor.name === 'Http2SecureServer'
      const request = isHttps ? httpsRequest : httpRequest
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/workspaces/band-a/presence/stream',
          headers: { origin: 'http://localhost:5173' },
          rejectUnauthorized: false,
        },
        () => {},
      )
      req.end()

      const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        req.on('response', resolve)
        req.on('error', reject)
      })

      expect(res.headers['content-type']).toBe('text/event-stream')

      const chunks = res[Symbol.asyncIterator]()

      const first = await chunks.next()
      expect(Buffer.from(first.value as Buffer).toString()).toBe('data: {"devices":{}}\n\n')

      setPresenceEntry('band-a', 'device-1', { profileId: 'p1', lastSeenAt: 123 })

      const second = await chunks.next()
      expect(Buffer.from(second.value as Buffer).toString()).toBe(
        `data: ${JSON.stringify({ devices: { 'device-1': { profileId: 'p1', lastSeenAt: 123 } } })}\n\n`,
      )

      req.destroy()
    })
  })

  describe('POST /workspaces/:workspaceId/device-info/report', () => {
    beforeEach(() => {
      __resetDeviceInfoStoreForTests()
    })

    it('records the reported info with a server-stamped ip and lastSeenAt', async () => {
      const before = Date.now()
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1', os: 'iPad', environment: 'browser', syncStatus: 'idle' },
      })

      expect(response.statusCode).toBe(204)
      const entry = getDeviceInfoSnapshot('band-a').devices['device-1']
      expect(entry.os).toBe('iPad')
      expect(entry.environment).toBe('browser')
      expect(entry.syncStatus).toBe('idle')
      expect(entry.lastSeenAt).toBeGreaterThanOrEqual(before)
      expect(entry.ip.length).toBeGreaterThan(0)
      expect(entry.networkReachable).toBeNull()
      expect(entry.hostname).toBeNull()
    })

    it('preserves networkReachable/hostname from a prior pingLoop patch across a new report', async () => {
      setDeviceInfoEntry('band-a', 'device-1', {
        ip: '127.0.0.1',
        os: 'iPad',
        environment: 'browser',
        syncStatus: 'idle',
        lastSeenAt: 1,
        networkReachable: true,
        hostname: 'ipad.local',
      })

      await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1', os: 'iPad', environment: 'browser', syncStatus: 'syncing' },
      })

      const entry = getDeviceInfoSnapshot('band-a').devices['device-1']
      expect(entry.networkReachable).toBe(true)
      expect(entry.hostname).toBe('ipad.local')
      expect(entry.syncStatus).toBe('syncing')
    })

    it('passes the audio output health and the device condition through', async () => {
      const vitals = { level: 'error', issues: ['audioMissing', 'memoryTight'], memAvailMb: 250, audioClockPct: -0.5, stallsPerMin: 3, uptimeMin: 1050 }
      await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1', os: 'Android', environment: 'native', syncStatus: 'idle', audioOutput: { path: 'webview', delayMs: null, missingMs: 0, jumps: 0, leadMinMs: null, fellBack: true }, vitals },
      })
      const entry = getDeviceInfoSnapshot('band-a').devices['device-1']
      expect(entry.audioOutput?.fellBack).toBe(true)
      expect(entry.vitals).toEqual(vitals)
    })

    it('passes the Play lead a device needed through (2026-11-06)', async () => {
      await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1', os: 'Android', environment: 'native', syncStatus: 'idle', leadNeededMs: 943 },
      })
      expect(getDeviceInfoSnapshot('band-a').devices['device-1'].leadNeededMs).toBe(943)
    })

    it('passes battery, MIDI outputs, silenced sources and foreground through for the map check (#747, #815)', async () => {
      await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1', os: 'Android', environment: 'native', syncStatus: 'idle', battery: { pct: 17, charging: false }, midiOutputs: ['Kemper Player'], silenced: ['click'], foreground: false },
      })
      const entry = getDeviceInfoSnapshot('band-a').devices['device-1']
      expect(entry.battery).toEqual({ pct: 17, charging: false })
      expect(entry.midiOutputs).toEqual(['Kemper Player'])
      expect(entry.silenced).toEqual(['click'])
      // Minimised at that report (#815).
      expect(entry.foreground).toBe(false)
      // An older app sends none of them.
      await app.inject({ method: 'POST', url: '/workspaces/band-a/device-info/report', payload: { deviceId: 'device-2', os: 'Android', environment: 'native', syncStatus: 'idle' } })
      expect(getDeviceInfoSnapshot('band-a').devices['device-2']).toMatchObject({ battery: null, midiOutputs: null, silenced: null, foreground: null })
    })

    it('rejects a body missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1' },
      })
      expect(response.statusCode).toBe(400)
    })

    it('keeps reports scoped to their own workspace', async () => {
      await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/device-info/report',
        payload: { deviceId: 'device-1', os: 'iPad', environment: 'browser', syncStatus: 'idle' },
      })
      expect(getDeviceInfoSnapshot('band-b').devices['device-1']).toBeUndefined()
    })
  })

  describe('GET /workspaces/:workspaceId/device-info', () => {
    beforeEach(() => {
      __resetDeviceInfoStoreForTests()
    })

    it('returns an empty snapshot when nothing has reported yet', async () => {
      const response = await app.inject({ method: 'GET', url: '/workspaces/band-a/device-info' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ devices: {}, collectingSince: expect.any(Number) })
    })

    it('returns the current snapshot, scoped to the requested workspace', async () => {
      const entry = {
        ip: '127.0.0.1',
        os: 'iPad',
        environment: 'browser' as const,
        syncStatus: 'idle' as const,
        lastSeenAt: 123,
        networkReachable: null,
        hostname: null,
      }
      setDeviceInfoEntry('band-a', 'device-1', entry)

      const response = await app.inject({ method: 'GET', url: '/workspaces/band-a/device-info' })
      expect(response.json()).toEqual({ devices: { 'device-1': entry }, collectingSince: expect.any(Number) })
      expect(await app.inject({ method: 'GET', url: '/workspaces/band-b/device-info' }).then((r) => r.json())).toEqual({ devices: {}, collectingSince: expect.any(Number) })
    })
  })

  describe('POST /workspaces/:workspaceId/devices/:deviceId/revoke', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function stubAdminVerify() {
      return { ok: true, status: 200, json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']) }
    }

    it('marks a device revoked, preserving its other fields', async () => {
      const existingDoc = { _id: 'devices:device-1', _rev: '1-a', id: 'device-1', name: 'Marcos iPad', lastSeenAt: 100, firstSeenAt: 50, revoked: false }
      const fetchMock = stubFetch([
        stubAdminVerify(),
        { ok: true, status: 200, json: async () => existingDoc }, // getDoc pre-check
        { ok: true, status: 200, json: async () => existingDoc }, // putDocWithRetry's own getDoc
        { ok: true, status: 200 }, // putDocWithRetry's PUT
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/devices/device-1/revoke',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', revoked: true },
      })

      expect(response.statusCode).toBe(204)
      const putBody = JSON.parse(fetchMock.mock.calls[3][1].body)
      expect(putBody).toMatchObject({ id: 'device-1', name: 'Marcos iPad', revoked: true, _rev: '1-a' })
    })

    it('returns 404 for a device that does not exist', async () => {
      stubFetch([stubAdminVerify(), { ok: false, status: 404 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/devices/unknown-device/revoke',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', revoked: true },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 404 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/devices/device-1/revoke',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw', revoked: true },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  it('master mode: only an admin of this band, never one of another band (no database login tried)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/master-mode',
        payload: { adminUsername: 'stageboard-band-b-p1', adminPassword: '1234', masterMode: 'account' },
      })
      expect(response.statusCode).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('wrong admin logins lock the account on the /db proxy too - no unlimited PIN guessing (#396 review)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    try {
      for (let i = 0; i < 5; i++) {
        await app.inject({ method: 'POST', url: '/workspaces/band-a/master-mode', payload: { adminUsername: 'stageboard-band-a-p9', adminPassword: `${1000 + i}`, masterMode: 'account' } })
      }
      const response = await app.inject({
        method: 'GET',
        url: '/db/stageboard-band-a/_all_docs',
        headers: { authorization: `Basic ${Buffer.from('stageboard-band-a-p9:1005').toString('base64')}` },
      })
      expect(response.statusCode).toBe(429)
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the /db proxy refuses another band\'s account before the request reaches the database', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/db/stageboard-band-a/_all_docs',
      headers: { authorization: `Basic ${Buffer.from('stageboard-band-b-p1:pw').toString('base64')}` },
    })
    expect(response.statusCode).toBe(403)
  })

  describe('POST /workspaces/:workspaceId/devices/:deviceId/forget', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }
    afterEach(() => {
      vi.unstubAllGlobals()
    })
    const admin = { ok: true, status: 200, json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']) }
    const payload = { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' }
    const device = (extra: object = {}) => ({ _id: 'devices:device-1', _rev: '3-c', id: 'device-1', name: 'Altes Tablet', lastSeenAt: 100, revoked: false, ...extra })
    const hardware = (docs: object[]) => ({ ok: true, status: 200, json: async () => ({ rows: docs.map((doc) => ({ doc })) }) })

    it('deletes an unused, unblocked device from the ledger', async () => {
      const fetchMock = stubFetch([
        admin,
        { ok: true, status: 200, json: async () => device() },
        hardware([{ _id: 'logical-devices:k', name: 'Kemper', executionTarget: 'other-device' }]),
        { ok: true, status: 200, json: async () => device() },
        { ok: true, status: 200 },
      ])
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/devices/device-1/forget', payload })
      expect(response.statusCode).toBe(204)
      const [url, init] = fetchMock.mock.calls[4]
      expect(String(url)).toContain('devices%3Adevice-1?rev=3-c')
      expect(init.method).toBe('DELETE')
    })

    it('a write in between is a conflict - read again, and a block set meanwhile is honoured (#426 review)', async () => {
      const fetchMock = stubFetch([
        admin,
        { ok: true, status: 200, json: async () => device() },
        hardware([]),
        { ok: true, status: 200, json: async () => device() },
        { ok: false, status: 409 },
        { ok: true, status: 200, json: async () => device({ _rev: '4-d', revoked: true }) },
      ])
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/devices/device-1/forget', payload })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ message: 'blocked' })
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    it('refuses a blocked device - deleting the entry would lift the block', async () => {
      const fetchMock = stubFetch([admin, { ok: true, status: 200, json: async () => device({ revoked: true }) }])
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/devices/device-1/forget', payload })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ message: 'blocked' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('refuses a device a hardware device runs on, and names it', async () => {
      const fetchMock = stubFetch([admin, { ok: true, status: 200, json: async () => device() }, hardware([{ _id: 'logical-devices:k', name: 'Kemper', executionTarget: 'device-1' }, { _id: 'logical-devices:c', name: 'Click', executionTarget: 'device-1' }])])
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/devices/device-1/forget', payload })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ message: 'in-use', usedBy: ['Kemper', 'Click'] })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('returns 403 for a non-admin and 404 for an unknown device', async () => {
      stubFetch([{ ok: false, status: 404 }])
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/devices/device-1/forget', payload })).statusCode).toBe(403)
      stubFetch([admin, { ok: false, status: 404 }])
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/devices/nope/forget', payload })).statusCode).toBe(404)
    })
  })

  describe('Discovery Mode routes', () => {
    beforeEach(() => {
      __resetDiscoverySessionStoreForTests()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('start reads the workspace\'s plugins/logical devices and marks the session active', async () => {
      stubFetch([
        { ok: true, json: async () => ({ rows: [] }) }, // plugins
        { ok: true, json: async () => ({ rows: [] }) }, // logical devices
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/discovery/start',
        payload: { startedBy: 'marco' },
      })

      expect(response.statusCode).toBe(200)
      expect(getDiscoverySnapshot('band-a')).toMatchObject({ active: true, startedBy: 'marco' })
    })

    it('start defaults startedBy to null when the body omits it', async () => {
      stubFetch([{ ok: true, json: async () => ({ rows: [] }) }, { ok: true, json: async () => ({ rows: [] }) }])

      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/discovery/start', payload: {} })

      expect(response.statusCode).toBe(200)
      expect(getDiscoverySnapshot('band-a').startedBy).toBeNull()
    })

    it('stop deactivates an active session', async () => {
      stubFetch([{ ok: true, json: async () => ({ rows: [] }) }, { ok: true, json: async () => ({ rows: [] }) }])
      await app.inject({ method: 'POST', url: '/workspaces/band-a/discovery/start', payload: {} })

      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/discovery/stop' })

      expect(response.statusCode).toBe(200)
      expect(getDiscoverySnapshot('band-a').active).toBe(false)
    })

    it('candidates rejects a malformed body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/discovery/candidates',
        payload: { reporterId: 'tablet-1' }, // missing `detected`
      })
      expect(response.statusCode).toBe(400)
    })

    it('candidates reports a device while the session is active (no session yet: silently ignored, not an error)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/discovery/candidates',
        payload: { reporterId: 'tablet-1', detected: { kind: 'webmidi', portId: 'port-1', name: 'Kemper', manufacturer: '' } },
      })
      expect(response.statusCode).toBe(200)
      expect(getDiscoverySnapshot('band-a').candidates).toHaveLength(0)
    })

    it('triggered rejects a malformed body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/discovery/triggered',
        payload: { reporterId: 'tablet-1' }, // missing `hardwareKey`
      })
      expect(response.statusCode).toBe(400)
    })

    it('streams the current snapshot immediately, then pushes updates as they happen', async () => {
      await app.listen({ port: 0 })
      const address = app.server.address()
      if (typeof address !== 'object' || address === null) throw new Error('server has no address')

      // See the plugin-health stream test above for why this isn't a plain `instanceof` check.
      const isHttps = app.server instanceof HttpsServer || app.server.constructor.name === 'Http2SecureServer'
      const request = isHttps ? httpsRequest : httpRequest
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/workspaces/band-a/discovery/stream',
          headers: { origin: 'http://localhost:5173' },
          rejectUnauthorized: false,
        },
        () => {},
      )
      req.end()

      const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        req.on('response', resolve)
        req.on('error', reject)
      })
      expect(res.headers['content-type']).toBe('text/event-stream')

      const chunks = res[Symbol.asyncIterator]()
      const first = await chunks.next()
      expect(Buffer.from(first.value as Buffer).toString()).toBe(
        `data: ${JSON.stringify({ active: false, startedAt: null, startedBy: null, candidates: [], identifying: null })}\n\n`,
      )

      stubFetch([{ ok: true, json: async () => ({ rows: [] }) }, { ok: true, json: async () => ({ rows: [] }) }])
      await app.inject({ method: 'POST', url: '/workspaces/band-a/discovery/start', payload: { startedBy: 'marco' } })

      const second = await chunks.next()
      expect(JSON.parse(Buffer.from(second.value as Buffer).toString().slice('data: '.length))).toMatchObject({
        active: true,
        startedBy: 'marco',
      })

      req.destroy()
    })
  })

  describe('POST /workspaces', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('provisions a new workspace (incl. its standing access code) and returns the founder\'s own personal credential', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ['stageboard-band-a'] }, // _all_dbs (who may found)
        { ok: true, status: 200, json: async () => ['stageboard-band-a'] }, // _all_dbs (is it taken?)
        { ok: true, status: 201 }, // ensureDb
        { ok: true, status: 200 }, // putSecurity
        { ok: true, status: 201 }, // putDoc (_design/roster)
        { ok: false, status: 404 }, // writeAccessCodeDoc's own getDoc (for _rev) -> missing
        { ok: true, status: 201 }, // putDoc (workspace:access)
        { ok: false, status: 404 }, // the founder's login: getDoc -> missing
        { ok: true, status: 201 }, // ... PUT (account:<founder>~<device>)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { workspaceId: 'band-c', founderId: 'p1', workspaceName: 'Band C', deviceId: 'dev-1' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.username).toBe('stageboard-band-c-p1~dev-1')
      expect(typeof body.password).toBe('string')
    })

    it('returns 409 when the workspace is already provisioned', async () => {
      stubFetch([{ ok: true, status: 200, json: async () => ['stageboard-band-a'] }, { ok: true, status: 200, json: async () => ['stageboard-band-a'] }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A' },
      })

      expect(response.statusCode).toBe(409)
    })

    it('refuses a band id that extends another band id - its accounts would look like that band\'s', async () => {
      for (const workspaceId of ['band-a-evil', 'band']) {
        stubFetch([{ ok: true, status: 200, json: async () => ['stageboard-band-a'] }])
        const response = await app.inject({ method: 'POST', url: '/workspaces', payload: { workspaceId, founderId: 'p1', workspaceName: 'X' } })
        expect(response.statusCode).toBe(400)
      }
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /workspaces - who may provision (#364)', () => {
    const fromLan = { remoteAddress: '192.168.178.50' }
    const provisionResponses = [
      { ok: true, status: 200, json: async () => ['stageboard-band-a'] }, // _all_dbs (is the id taken?)
      { ok: true, status: 201 }, // ensureDb
      { ok: true, status: 200 }, // putSecurity
      { ok: true, status: 201 }, // putDoc (_design/roster)
      { ok: false, status: 404 }, // access code getDoc
      { ok: true, status: 201 }, // putDoc (workspace:access)
      { ok: false, status: 404 }, // the founder's login: getDoc -> missing
      { ok: true, status: 201 }, // ... PUT
    ]
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }
    const payload = { workspaceId: 'band-new', founderId: 'p1', workspaceName: 'Neue Band' }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const someBands = { ok: true, status: 200, json: async () => ['stageboard-band-a'] } // _all_dbs
    const noBands = { ok: true, status: 200, json: async () => ['_replicator'] }

    it('refuses a LAN request without an admin login once a band exists', async () => {
      const fetchMock = stubFetch([someBands])
      const response = await app.inject({ method: 'POST', url: '/workspaces', payload, ...fromLan })
      expect(response.statusCode).toBe(403)
      expect(response.json().code).toBe('admin-required')
      expect(fetchMock).toHaveBeenCalledTimes(1) // only the band listing - nothing provisioned
    })

    it('lets anyone found the first band on a fresh server', async () => {
      stubFetch([noBands, ...provisionResponses])
      const response = await app.inject({ method: 'POST', url: '/workspaces', payload, ...fromLan })
      expect(response.statusCode).toBe(201)
    })

    it('accepts an admin of a band on this server', async () => {
      stubFetch([
        someBands,
        someBands, // which band the login belongs to
        { ok: true, status: 200, json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']) },
        ...provisionResponses,
      ])
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { ...payload, adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
        ...fromLan,
      })
      expect(response.statusCode).toBe(201)
    })

    it('locks an admin account after 5 wrong logins', async () => {
      const wrong = { ok: false, status: 404, json: async () => ({ error: 'unauthorized' }) }
      const fetchMock = stubFetch([someBands, someBands, wrong, someBands, someBands, wrong, someBands, someBands, wrong, someBands, someBands, wrong, someBands, someBands, wrong, someBands])
      const found = (adminPassword: string) =>
        app.inject({ method: 'POST', url: '/workspaces', payload: { ...payload, adminUsername: 'stageboard-band-a-p1', adminPassword }, ...fromLan })
      for (const pin of ['1000', '1001', '1002', '1003', '1004']) expect((await found(pin)).statusCode).toBe(403)
      expect((await found('1005')).statusCode).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(16) // the sixth try never reaches the login
    })

    it('never provisions a deleted band again, not even from the server itself', async () => {
      recordDeletedWorkspace('band-gone')
      const fetchMock = stubFetch([])
      const response = await app.inject({ method: 'POST', url: '/workspaces', payload: { ...payload, workspaceId: 'band-gone' } })
      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('deleted')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('GET /workspaces (2026-09-01 WiFi-style redesign: the "which networks are in range" listing)', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('lists every stageboard-* database with its display name, no auth required', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ['stageboard-band-a', 'stageboard-band-c'] }, // _all_dbs
        { ok: true, status: 200, json: async () => ({ code: '11111111', name: 'Band A' }) }, // band-a access code
        { ok: true, status: 200, json: async () => ({ code: '22222222', name: 'Band C' }) }, // band-c access code
      ])

      const response = await app.inject({ method: 'GET', url: '/workspaces' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual([
        { workspaceId: 'band-a', workspaceName: 'Band A' },
        { workspaceId: 'band-c', workspaceName: 'Band C' },
      ])
    })
  })

  describe('show-state push (#468)', () => {
    const basic = (username: string, password: string) => ({ authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` })
    const session = (name: string) => vi.fn(async () => new Response(JSON.stringify(accountDoc(name, ['member'], 'pw')), { status: 200 }))
    const push = { deviceId: 'tablet-1', issuedAt: 1_000, patch: { playbackStatus: 'playing', playbackStartedAt: 1_400, playbackAccumulatedMs: 0 } }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('only takes pushes from a device signed in to this band', async () => {
      const send = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/workspaces/band-a/show-state/push', payload: push, headers })
      expect((await send({})).statusCode).toBe(401)
      expect((await send(basic('stageboard-band-b-p9~d9', 'pw'))).statusCode).toBe(401) // another band's device
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
      expect((await send(basic('stageboard-band-a-p9~d9', 'wrong'))).statusCode).toBe(401)
    })

    it('passes the change to every device of the band at once, and checks a login only once', async () => {
      const fetchMock = session('stageboard-band-a-p7~d7')
      vi.stubGlobal('fetch', fetchMock)
      const received: unknown[] = []
      const other: unknown[] = []
      const off = showStatePushHub.subscribe('band-a', (event) => received.push(event))
      const offOther = showStatePushHub.subscribe('band-b', (event) => other.push(event))
      const headers = basic('stageboard-band-a-p7~d7', 'pw')
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/show-state/push', payload: push, headers })).statusCode).toBe(204)
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/show-state/push', payload: push, headers })).statusCode).toBe(204)
      expect(received).toEqual([push, push])
      expect(other).toEqual([])
      // The first push checks the login: the account, and the band's list of hosts (the host role, #960). The second one is remembered.
      expect(fetchMock).toHaveBeenCalledTimes(2)
      off()
      offOther()
    })

    it('rejects a malformed push and takes the arrival reports', async () => {
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/show-state/push', payload: { patch: {} } })).statusCode).toBe(400)
      const ack = { deviceId: 'tablet-2', issuedAt: 1_000, receivedAt: 1_035, via: 'push' }
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/show-state/ack', payload: ack })).statusCode).toBe(204)
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/show-state/ack', payload: { ...ack, via: 'mail' } })).statusCode).toBe(400)
    })
  })

  describe('POST /workspaces/:workspaceId/flash (#26)', () => {
    const basic = (username: string, password: string) => ({ authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` })
    const signedIn = basic('stageboard-band-a-p1~d1', 'pw')
    const session = (name: string) => vi.fn(async () => new Response(JSON.stringify(accountDoc(name, ['member'], 'pw')), { status: 200 }))

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('only takes messages from a device signed in to this band', async () => {
      const send = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/workspaces/band-a/flash', payload: { text: 'VAMP' }, headers })
      expect((await send({})).statusCode).toBe(401)
      const fetchMock = session('stageboard-band-b-p1~d1')
      vi.stubGlobal('fetch', fetchMock)
      expect((await send(basic('stageboard-band-b-p1~d1', 'pw'))).statusCode).toBe(401) // another band's device
      expect(fetchMock).not.toHaveBeenCalled()
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
      expect((await send(signedIn)).statusCode).toBe(401) // wrong password
    })

    it('stores the message, returns it with id and time, and rejects empty text', async () => {
      vi.stubGlobal('fetch', session('stageboard-band-a-p1~d1'))
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/flash', payload: { text: '  VAMP  ', from: 'Caro' }, headers: signedIn })
      expect(response.statusCode).toBe(201)
      const flash = response.json()
      expect(flash).toMatchObject({ text: 'VAMP', from: 'Caro' })
      expect(typeof flash.id).toBe('string')
      expect(typeof flash.at).toBe('number')
      expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/flash', payload: { text: '   ' } })).statusCode).toBe(400)
    })

    it('carries the recipients along, or none for everyone', async () => {
      vi.stubGlobal('fetch', session('stageboard-band-a-p1~d1'))
      const toOne = await app.inject({ method: 'POST', url: '/workspaces/band-a/flash', payload: { text: 'Gitarre stimmen', to: ['p2'] }, headers: signedIn })
      expect(toOne.json()).toMatchObject({ text: 'Gitarre stimmen', to: ['p2'] })
      const toAll = await app.inject({ method: 'POST', url: '/workspaces/band-a/flash', payload: { text: 'VAMP', to: [] }, headers: signedIn })
      expect(toAll.json().to).toBeUndefined()
    })
  })

  describe('POST /workspaces/:workspaceId/roster', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('resolves the roster with the correct code, reporting isAdmin per member (no requiresPassword anymore - only admin entries ever need a code)', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code
        {
          ok: true,
          status: 200,
          json: async () => ({
            rows: [
              { doc: { _id: 'profiles:p1', id: 'p1', name: 'Marco', stageRoles: ['admin'] } },
              { doc: { _id: 'profiles:p2', id: 'p2', name: 'Chris' } },
            ],
          }),
        }, // allDocs (roster)
      ])

      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/roster', payload: { code: '12345678' } })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        workspaceId: 'band-a',
        workspaceName: 'Band A',
        members: [
          { profileId: 'p1', name: 'Marco', isAdmin: true },
          { profileId: 'p2', name: 'Chris', isAdmin: false },
        ],
      })
    })

    it('returns 403 for the wrong code', async () => {
      stubFetch([{ ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }])

      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/roster', payload: { code: 'wrong-code' } })

      expect(response.statusCode).toBe(403)
    })

    it('lazily creates a workspace\'s access code on first use, rather than erroring - the pre-existing-workspace backfill (any guessed code still correctly fails, since the real one was just generated)', async () => {
      stubFetch([
        { ok: false, status: 404 }, // getAccessCode -> missing
        { ok: false, status: 404 }, // writeAccessCodeDoc's own getDoc (for _rev) -> still missing
        { ok: true, status: 201 }, // putDoc (workspace:access) - lazily created
      ])

      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/roster', payload: { code: 'guessed' } })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/roster', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /workspaces/:workspaceId/access-code', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns the current code without changing it, when the caller verifies as an admin', async () => {
      const fetchMock = stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']),
        }, // verifyAdmin
        { ok: true, status: 200, json: async () => ({ code: '11111111', name: 'Band A' }) }, // getAccessCode - already exists
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/access-code',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ code: '11111111' })
      expect(fetchMock).toHaveBeenCalledTimes(2) // no write - just a read
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 404 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/access-code',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw' },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('POST /workspaces/:workspaceId/access-code/rotate', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('rotates the code when the caller verifies as an admin', async () => {
      const fetchMock = stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']),
        }, // verifyAdmin
        { ok: true, status: 200, json: async () => ({ _rev: '1-abc', code: '11111111', name: 'Band A' }) }, // putDocWithRetry's getDoc
        { ok: true, status: 201 }, // putDoc with new code
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/access-code/rotate',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().code).toMatch(/^\d{8}$/)
      expect(fetchMock.mock.calls.length).toBe(3)
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 404 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/access-code/rotate',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw' },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('POST /workspaces/:workspaceId/name', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('renames the workspace when the caller verifies as an admin, keeping the existing access code (#58)', async () => {
      const fetchMock = stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']),
        }, // verifyAdmin
        { ok: true, status: 200, json: async () => ({ _rev: '1-abc', code: '11111111', name: 'Band A' }) }, // putDocWithRetry's getDoc
        { ok: true, status: 201 }, // putDoc with new name
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/name',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', name: 'The Renamed Band' },
      })

      expect(response.statusCode).toBe(200)
      expect(fetchMock.mock.calls.length).toBe(3)
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 404 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/name',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw', name: 'The Renamed Band' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for an empty name', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/name',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', name: '' },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('verify-admin-pin, activate-hardware and GET /server/active-workspace', () => {
    /** Routes the database calls by URL instead of by call order, so these tests don't depend on how
     * many round trips verifyAdminPin happens to make. `bands` maps a workspace id to its roster
     * (profileId -> isAdmin), its access code, and optionally each admin's own PIN. */
    function stubDatabase(bands: Record<string, { roster: Record<string, boolean>; code: string; pins?: Record<string, string> }>) {
      const fetchMock = vi.fn(async (input: string | URL, init?: { headers?: Record<string, string> }) => {
        const url = String(input)
        const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
        const notFound = { ok: false, status: 404 } as Response

        const roster = url.match(/\/stageboard-([^/]+)\/_all_docs\?/)
        if (roster && bands[roster[1]]) {
          const band = bands[roster[1]]
          return json({
            rows: Object.entries(band.roster).map(([profileId, isAdmin]) => ({
              doc: { _id: `profiles:${profileId}`, id: profileId, name: `Name ${profileId}`, stageRoles: isAdmin ? ['admin'] : ['instrumentalist'] },
            })),
          })
        }
        const match = url.match(/\/stageboard-([^/]+)\/(.+)$/)
        const band = match && bands[match[1]]
        if (!band) return notFound
        const doc = decodeURIComponent(match[2])
        if (doc === 'workspace:access') return json({ _id: doc, code: band.code, name: 'Band' })
        // An admin's PIN is kept as a verifier (`anchor:<profile>`); a login of the same person checks against the PIN too.
        const pinOf = (profileId: string) => band.pins?.[profileId]
        if (doc.startsWith('anchor:') && pinOf(doc.slice('anchor:'.length))) return json({ ...accountDoc('x', [], pinOf(doc.slice('anchor:'.length))), _id: doc, profileId: doc.slice('anchor:'.length) })
        if (doc.startsWith('account:')) {
          const user = doc.slice('account:'.length)
          const profileId = user.slice(`stageboard-${match![1]}-`.length).split('~')[0]!
          return pinOf(profileId) ? json(accountDoc(user, ['member', 'admin'], pinOf(profileId))) : notFound
        }
        if (doc.startsWith('profiles:')) {
          const profileId = doc.slice('profiles:'.length)
          return profileId in band.roster
            ? json({ _id: doc, id: profileId, stageRoles: band.roster[profileId] ? ['admin'] : ['instrumentalist'] })
            : notFound
        }
        return notFound
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    const bandA = { roster: { p1: true, p2: false }, code: '11112222', pins: { p1: '4242' } }
    const bandB = { roster: { q1: true }, code: '33334444' }

    const activate = (workspaceId: string, payload: unknown) =>
      app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/activate-hardware`, payload: payload as never })

    let stateDir: string

    beforeEach(() => {
      stateDir = mkdtempSync(join(tmpdir(), 'stageboard-active-workspace-route-test-'))
      process.env.STAGEBOARD_STATE_DIR = stateDir
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      delete process.env.STAGEBOARD_STATE_DIR
      rmSync(stateDir, { recursive: true, force: true })
    })

    describe('temporary lockout after wrong PINs', () => {
      const bandC = { roster: { p1: true, p3: true }, code: '55556666', pins: { p1: '4242', p3: '5353' } }
      const verify = (workspaceId: string, profileId: string, pin: string) =>
        app.inject({ method: 'POST', url: `/workspaces/${workspaceId}/verify-admin-pin`, payload: { profileId, pin } })
      const wrong = async (n: number, workspaceId = 'band-c', profileId = 'p1') => {
        for (let i = 0; i < n; i++) expect((await verify(workspaceId, profileId, '0000')).statusCode).toBe(403)
      }

      afterEach(() => {
        vi.useRealTimers()
      })

      it('locks an admin after 5 wrong PINs - even the right PIN is refused, with how long to wait', async () => {
        stubDatabase({ 'band-c': bandC })
        await wrong(5)

        const locked = await verify('band-c', 'p1', '4242')

        expect(locked.statusCode).toBe(429)
        expect(Number(locked.headers['retry-after'])).toBeGreaterThan(290)
        expect(Number(locked.headers['retry-after'])).toBeLessThanOrEqual(300)
        expect(locked.json()).toMatchObject({ status: 'error', retryAfterSeconds: Number(locked.headers['retry-after']) })
      })

      it('only for a dedicated time: the lock lifts by itself and the right PIN works again', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        stubDatabase({ 'band-c': bandC })
        await wrong(5)
        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(429)

        vi.setSystemTime(Date.now() + 5 * 60_000 + 1000)

        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(200)
      })

      it('after the lock ends the full budget is back, not a single strike', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        stubDatabase({ 'band-c': bandC })
        await wrong(5)
        vi.setSystemTime(Date.now() + 5 * 60_000 + 1000)

        await wrong(4)

        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(200)
      })

      it('a correct PIN resets the count', async () => {
        stubDatabase({ 'band-c': bandC })
        await wrong(4)
        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(200)

        await wrong(4)

        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(200)
      })

      it('locks one admin, not the band - another admin of the same band still works', async () => {
        stubDatabase({ 'band-c': bandC })
        await wrong(5)

        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(429)
        expect((await verify('band-c', 'p3', '5353')).statusCode).toBe(200)
      })

      it('verify-admin-pin and activate-hardware share one budget, so neither is a way around the other', async () => {
        stubDatabase({ 'band-c': bandC })
        await wrong(3)
        for (let i = 0; i < 2; i++) {
          expect((await activate('band-c', { opening: { profileId: 'p1', pin: '0000' } })).statusCode).toBe(403)
        }

        expect((await verify('band-c', 'p1', '4242')).statusCode).toBe(429)
      })

      it('activate-hardware refuses a locked opening admin even with the right PIN, activating nothing', async () => {
        stubDatabase({ 'band-c': bandC })
        await wrong(5)

        const response = await activate('band-c', { opening: { profileId: 'p1', pin: '4242' } })

        expect(response.statusCode).toBe(429)
        expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: null })
      })

      it('a locked closing admin blocks the switch away from that band too', async () => {
        stubDatabase({ 'band-c': bandC, 'band-b': bandB })
        await activate('band-c', { opening: { profileId: 'p1', pin: '4242' } })
        await wrong(5)

        const response = await activate('band-b', {
          opening: { profileId: 'q1', pin: '4444' },
          closing: { profileId: 'p1', pin: '4242' },
        })

        expect(response.statusCode).toBe(429)
        expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: 'band-c' })
      })
    })

    describe('GET /server/active-workspace/admins', () => {
      it('is 404 when nothing is active', async () => {
        const response = await app.inject({ method: 'GET', url: '/server/active-workspace/admins' })
        expect(response.statusCode).toBe(404)
      })

      it('lists only the admins (id + name) of the band the server is serving, with no code', async () => {
        stubDatabase({ 'band-a': bandA, 'band-b': bandB })
        await activate('band-a', { opening: { profileId: 'p1', pin: '4242' } })

        const response = await app.inject({ method: 'GET', url: '/server/active-workspace/admins' })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ workspaceId: 'band-a', admins: [{ profileId: 'p1', name: 'Name p1' }] })
      })

      it('follows the switch - after switching, it lists the new active band\'s admins, never the old one\'s', async () => {
        stubDatabase({ 'band-a': bandA, 'band-b': bandB })
        await activate('band-a', { opening: { profileId: 'p1', pin: '4242' } })
        await activate('band-b', { opening: { profileId: 'q1', pin: '4444' }, closing: { profileId: 'p1', pin: '4242' } })

        const response = await app.inject({ method: 'GET', url: '/server/active-workspace/admins' })

        expect(response.json()).toEqual({ workspaceId: 'band-b', admins: [{ profileId: 'q1', name: 'Name q1' }] })
      })
    })

    it('reports no active workspace before anything is activated', async () => {
      const response = await app.inject({ method: 'GET', url: '/server/active-workspace' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ activeWorkspaceId: null })
    })

    it('activates on a first activation (nothing to close) with just the opening admin\'s PIN', async () => {
      stubDatabase({ 'band-a': bandA })

      const response = await activate('band-a', { opening: { profileId: 'p1', pin: '4242' } })

      expect(response.statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: 'band-a' })
    })

    it('returns 403 for a wrong opening PIN and activates nothing', async () => {
      stubDatabase({ 'band-a': bandA })

      const response = await activate('band-a', { opening: { profileId: 'p1', pin: '0000' } })

      expect(response.statusCode).toBe(403)
      expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: null })
    })

    it('returns 403 for an admin of a *different* workspace (opening proof is checked against the target\'s own roster)', async () => {
      stubDatabase({ 'band-a': bandA, 'band-b': bandB })

      const response = await activate('band-a', { opening: { profileId: 'q1', pin: '4444' } })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      expect((await activate('band-a', {})).statusCode).toBe(400)
      expect((await activate('band-a', { opening: { profileId: 'p1', pin: '12' } })).statusCode).toBe(400)
    })

    describe('switching away from a currently active workspace', () => {
      beforeEach(async () => {
        stubDatabase({ 'band-a': bandA, 'band-b': bandB })
        await activate('band-a', { opening: { profileId: 'p1', pin: '4242' } })
      })

      it('returns 400 without closing proof, leaving the current band active', async () => {
        const response = await activate('band-b', { opening: { profileId: 'q1', pin: '4444' } })

        expect(response.statusCode).toBe(400)
        expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: 'band-a' })
      })

      it('returns 403 when the closing PIN is wrong, leaving the current band active', async () => {
        const response = await activate('band-b', {
          opening: { profileId: 'q1', pin: '4444' },
          closing: { profileId: 'p1', pin: '0000' },
        })

        expect(response.statusCode).toBe(403)
        expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: 'band-a' })
      })

      it('switches with both proofs, leaving no trace of the first band\'s plugins in GET /plugins', async () => {
        await registry.register(fakeShowControlPlugin(), testContext())
        expect(await (await app.inject({ method: 'GET', url: '/plugins' })).json()).toHaveLength(1)

        const response = await activate('band-b', {
          opening: { profileId: 'q1', pin: '4444' },
          closing: { profileId: 'p1', pin: '4242' },
        })

        expect(response.statusCode).toBe(200)
        expect((await app.inject({ method: 'GET', url: '/plugins' })).json()).toEqual([])
        expect((await app.inject({ method: 'GET', url: '/server/active-workspace' })).json()).toEqual({ activeWorkspaceId: 'band-b' })
      })
    })
  })

  describe('DELETE /workspaces/:workspaceId', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('deletes the workspace - its database, and with it every login and PIN - when the caller verifies as an admin', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'delete-band-'))
      vi.stubEnv('STAGEBOARD_STATE_DIR', stateDir)
      const fetchMock = stubFetch([
        { ok: true, status: 200, json: async () => accountDoc('stageboard-band-a-p1', ['member', 'admin']) },
        { ok: true, status: 200, json: async () => ({ rows: [] }) }, // the copy kept first (#362): _all_docs
        { ok: true, status: 200, json: async () => ({}) }, // ... _security
        { ok: true, status: 200 }, // deleteDb
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspaces/band-a',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(204)
      expect(fetchMock).toHaveBeenCalledTimes(4) // the login, the copy (2 reads), the database - no account is deleted one by one any more
      expect((fetchMock.mock.calls[3] as [string, RequestInit])[1].method).toBe('DELETE')
      expect(readdirSync(join(stateDir, 'deleted-bands'))).toHaveLength(1) // the band stays recoverable (#362)
      vi.unstubAllEnvs()
      rmSync(stateDir, { recursive: true, force: true })
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 404 }])

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspaces/band-a',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'DELETE', url: '/workspaces/band-a', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('CORS', () => {
    it('reflects an allowed origin (default FRONTEND_ORIGIN)', async () => {
      // The default's scheme tracks whether this server itself ended up HTTPS (dev certs
      // present locally, absent in CI, same as the plugin-health/stream test below) - a
      // hardcoded 'http://' here would fail locally the moment certs exist on disk. With certs,
      // it's an Http2SecureServer (#129), not a plain HttpsServer - same constructor-name check.
      const scheme = app.server instanceof HttpsServer || app.server.constructor.name === 'Http2SecureServer' ? 'https' : 'http'
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: `${scheme}://localhost:5173` },
      })
      expect(response.headers['access-control-allow-origin']).toBe(`${scheme}://localhost:5173`)
    })

    it('does not reflect a disallowed origin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://evil.example.com' },
      })
      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })
  })
})

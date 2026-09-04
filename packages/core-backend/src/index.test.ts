import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, Server as HttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { ILookupPlugin, IShowControlPlugin, PluginContext } from 'shared-types'
import { buildApp } from './index.js'
import { __resetHealthStoreForTests, getSnapshot, setEntry } from './plugins/healthStore.js'
import {
  __resetPresenceStoreForTests,
  getSnapshot as getPresenceSnapshot,
  setEntry as setPresenceEntry,
} from './presenceStore.js'

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
  })

  describe('GET /server-info', () => {
    afterEach(() => {
      delete process.env.LAN_IP
    })

    it('reports the LAN_IP override when set', async () => {
      process.env.LAN_IP = '10.1.2.3'
      const response = await app.inject({ method: 'GET', url: '/server-info' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ lanIp: '10.1.2.3' })
    })

    it('falls back to a detected address or null, never throwing, with no LAN_IP set', async () => {
      const response = await app.inject({ method: 'GET', url: '/server-info' })
      expect(response.statusCode).toBe(200)
      const { lanIp } = response.json() as { lanIp: string | null }
      expect(lanIp === null || typeof lanIp === 'string').toBe(true)
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
      // protocol and has to ask the actual running server which one it got.
      const request = app.server instanceof HttpsServer ? httpsRequest : httpRequest
      const req = request(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/plugin-health/band-a/stream',
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

      // CORS headers still apply even though the route bypasses Fastify's normal send path
      // (see index.ts's reply.hijack() comment) - this is the whole reason for copying them.
      expect(res.headers['content-type']).toBe('text/event-stream')
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')

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

      const request = app.server instanceof HttpsServer ? httpsRequest : httpRequest
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
        { ok: false, status: 404 }, // userExists
        { ok: true, status: 201 }, // createUser (founder)
        { ok: true, status: 201 }, // ensureDb
        { ok: true, status: 200 }, // putSecurity
        { ok: true, status: 201 }, // putDoc (_design/roster)
        { ok: false, status: 404 }, // writeAccessCodeDoc's own getDoc (for _rev) -> missing
        { ok: true, status: 201 }, // putDoc (workspace:access)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { workspaceId: 'band-c', founderId: 'p1', workspaceName: 'Band C' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.username).toBe('stageboard-band-c-p1')
      expect(typeof body.password).toBe('string')
    })

    it('returns 409 when the workspace is already provisioned', async () => {
      stubFetch([{ ok: true, status: 200, json: async () => ({ name: 'stageboard-band-a-p1' }) }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A' },
      })

      expect(response.statusCode).toBe(409)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /workspaces/:workspaceId/members', () => {
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
      return { ok: true, status: 200, json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }) }
    }

    it('provisions a new member with a server-generated password when none is given', async () => {
      const fetchMock = stubFetch([stubAdminVerify(), { ok: true, status: 201 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', profileId: 'p2' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json()
      expect(body.username).toBe('stageboard-band-a-p2')
      expect(typeof body.password).toBe('string')
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ roles: ['member'] })
    })

    it('uses the given password (PIN) instead of generating one, and grants admin when asked', async () => {
      const fetchMock = stubFetch([stubAdminVerify(), { ok: true, status: 201 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members',
        payload: {
          adminUsername: 'stageboard-band-a-p1',
          adminPassword: 'correct-pw',
          profileId: 'p2',
          password: '4711',
          isAdmin: true,
        },
      })

      expect(response.json()).toEqual({ username: 'stageboard-band-a-p2', password: '4711' })
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ roles: ['member', 'admin'], password: '4711' })
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 401 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw', profileId: 'p2' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/members', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /workspaces/:workspaceId/members/:profileId/admin', () => {
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
      return { ok: true, status: 200, json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }) }
    }

    function stubRoster(profiles: Array<{ id: string; stageRoles: string[] }>) {
      return { ok: true, status: 200, json: async () => ({ rows: profiles.map((p) => ({ doc: { _id: `profiles:${p.id}`, ...p } })) }) }
    }

    it('grants admin', async () => {
      const fetchMock = stubFetch([
        stubAdminVerify(),
        { ok: true, status: 200, json: async () => ({ _id: 'x', _rev: '1-a', name: 'x', type: 'user', roles: ['member'] }) }, // setUserRoles(anchor) GET
        { ok: true, status: 200 }, // setUserRoles(anchor) PUT
        { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames -> none
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/admin',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', isAdmin: true },
      })

      expect(response.statusCode).toBe(204)
      expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ roles: ['member', 'admin'] })
    })

    it('revokes admin when another admin remains', async () => {
      stubFetch([
        stubAdminVerify(),
        stubRoster([
          { id: 'p1', stageRoles: ['admin'] },
          { id: 'p2', stageRoles: ['admin'] },
        ]), // countOtherAdmins
        { ok: true, status: 200, json: async () => ({ _id: 'x', _rev: '1-a', name: 'x', type: 'user', roles: ['member', 'admin'] }) }, // setUserRoles(anchor) GET
        { ok: true, status: 200 }, // setUserRoles(anchor) PUT
        { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames -> none
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/admin',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', isAdmin: false },
      })

      expect(response.statusCode).toBe(204)
    })

    it('rejects revoking the sole remaining admin', async () => {
      stubFetch([stubAdminVerify(), stubRoster([{ id: 'p1', stageRoles: ['admin'] }])])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/admin',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw', isAdmin: false },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 401 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/admin',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw', isAdmin: true },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('DELETE /workspaces/:workspaceId/members/:profileId', () => {
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
      return { ok: true, status: 200, json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }) }
    }

    function stubRoster(profiles: Array<{ id: string; stageRoles: string[] }>) {
      return { ok: true, status: 200, json: async () => ({ rows: profiles.map((p) => ({ doc: { _id: `profiles:${p.id}`, ...p } })) }) }
    }

    it('deletes a plain member', async () => {
      stubFetch([
        stubAdminVerify(),
        stubRoster([{ id: 'p1', stageRoles: ['admin'] }]), // countOtherAdmins excluding p2 (not admin) - still 1
        { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames -> none
        { ok: false, status: 404 }, // deleteUser(anchor) GET - already gone is fine
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspaces/band-a/members/p2',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(204)
    })

    it('rejects deleting the sole remaining admin', async () => {
      stubFetch([stubAdminVerify(), stubRoster([{ id: 'p1', stageRoles: ['admin'] }])])

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspaces/band-a/members/p1',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(400)
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 401 }])

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspaces/band-a/members/p2',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw' },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('POST /workspaces/:workspaceId/members/:profileId/reset-password', () => {
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
      return { ok: true, status: 200, json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }) }
    }

    it('rotates the admin target\'s PIN to a fresh 4-digit one and returns it - no last-admin check, unlike remove/demote', async () => {
      const fetchMock = stubFetch([
        stubAdminVerify(),
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p2', id: 'p2', stageRoles: ['admin'] }) }, // getDoc profile
        // resetUserPassword: GET the existing user doc, then PUT it back with a new password.
        { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:stageboard-band-a-p2', _rev: '1-abc', name: 'stageboard-band-a-p2', roles: ['member', 'admin'], type: 'user' }) },
        { ok: true, status: 201 },
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/reset-password',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json() as { username: string; password: string }
      expect(body.username).toBe('stageboard-band-a-p2')
      expect(body.password).toMatch(/^\d{4}$/)

      // The PUT carries the new PIN, keeping every other field (roles included) intact.
      const [, putInit] = fetchMock.mock.calls[3]
      const putBody = JSON.parse((putInit as RequestInit).body as string)
      expect(putBody.password).toBe(body.password)
      expect(putBody.roles).toEqual(['member', 'admin'])
    })

    it('returns 400 for a non-admin target - there is no PIN to reset', async () => {
      const fetchMock = stubFetch([
        stubAdminVerify(),
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p2', id: 'p2' }) }, // getDoc profile, no stageRoles
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/reset-password',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-pw' },
      })

      expect(response.statusCode).toBe(400)
      expect(fetchMock).toHaveBeenCalledTimes(2) // no password-reset calls
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 401 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/reset-password',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw' },
      })

      expect(response.statusCode).toBe(403)
    })
  })

  describe('POST /workspaces/:workspaceId/members/:profileId/set-pin (2026-09-02 second follow-up: admin self-service PIN assignment)', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('verifies the caller is exactly the target admin account, then sets the PIN to the chosen value', async () => {
      const fetchMock = stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        }, // verifyUser(caller)
        { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:stageboard-band-a-p1', _rev: '1-abc', name: 'stageboard-band-a-p1', roles: ['member', 'admin'], type: 'user' }) },
        { ok: true, status: 201 },
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/set-pin',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'old-pin', newPin: '4711' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ username: 'stageboard-band-a-p1', password: '4711', isAdmin: true })
      const [, putInit] = fetchMock.mock.calls[2]
      expect(JSON.parse((putInit as RequestInit).body as string).password).toBe('4711')
    })

    it('rejects setting a *different* profile\'s PIN, even with valid admin credentials', async () => {
      const fetchMock = stubFetch([])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/set-pin',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'admin-pw', newPin: '4711' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects invalid caller credentials', async () => {
      stubFetch([{ ok: false, status: 401 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/set-pin',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'wrong', newPin: '4711' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('rejects a caller that verifies but does not hold the admin role', async () => {
      stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member'] } }),
        },
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/set-pin',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'member-pw', newPin: '4711' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for a PIN that is not exactly 4 digits', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/set-pin',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'old-pin', newPin: '12345' },
      })

      expect(response.statusCode).toBe(400)
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
        { ok: true, status: 200, json: async () => ['_users', '_replicator', 'stageboard-band-a', 'stageboard-band-c'] }, // _all_dbs
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

  describe('POST /workspaces/:workspaceId/join/:profileId', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('a non-admin target always succeeds, minting this device\'s own account, regardless of any password supplied', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p2', id: 'p2', name: 'Chris' }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
        // provisionDevice: this device has no account yet either - the password field is never
        // even looked at for a non-admin target.
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p2',
        payload: { code: '12345678', password: 'this is never checked', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json() as { username: string; password: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p2~device-1')
      expect(body.isAdmin).toBe(false)
    })

    it('auto-provisions a brand-new non-admin member (no anchor yet) plus this device\'s own account, with fresh, never-typed credentials', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p2', id: 'p2', name: 'Chris' }) }, // getDoc profile
        { ok: false, status: 404 }, // userExists(anchor) -> not provisioned
        { ok: true, status: 201 }, // createUser(anchor)
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p2',
        payload: { code: '12345678', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json() as { username: string; password: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p2~device-1')
      expect(body.password).toEqual(expect.any(String))
      expect(body.isAdmin).toBe(false)
    })

    it('verifies an admin\'s own self-assigned PIN against the anchor, then mints this device\'s own account', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', name: 'Marco', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        }, // verifyUser(anchor)
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p1',
        payload: { code: '12345678', password: '4711', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        username: 'stageboard-band-a-p1~device-1',
        password: expect.any(String),
        isAdmin: true,
      })
    })

    it('the universal recovery code (the access code\'s own last 4 digits) always logs into an admin account, minting this device\'s own fresh account, without ever checking the personal PIN', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code -> suffix '5678'
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
        // No verifyUser call at all - and the anchor itself is never touched, only this device's own.
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p1',
        payload: { code: '12345678', password: '5678', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json() as { username: string; password: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p1~device-1')
      expect(body.isAdmin).toBe(true)
    })

    it('returns 403 for an admin target with no password supplied at all - unlike a non-admin, there is nothing implicit to fall back on', async () => {
      const fetchMock = stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists -> already provisioned
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p1',
        payload: { code: '12345678', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(3) // no device-provisioning calls
    })

    it('returns 403 for an admin target when the supplied code matches neither the personal PIN nor the universal recovery suffix', async () => {
      const fetchMock = stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code -> suffix '5678'
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists -> already provisioned
        { ok: false, status: 401 }, // verifyUser fails
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p1',
        payload: { code: '12345678', password: 'wrong', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(4) // no device-provisioning calls after the failed verify
    })

    it('returns 403 for the wrong access code, before ever looking at the roster', async () => {
      const fetchMock = stubFetch([{ ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/p1',
        payload: { code: 'totally-wrong', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('returns 404 for a profileId with no matching roster entry', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // access code
        { ok: false, status: 404 }, // getDoc profile -> not found
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/join/ghost',
        payload: { code: '12345678', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 400 for a body missing deviceId', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/join/p1', payload: { code: '12345678' } })
      expect(response.statusCode).toBe(400)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/join/p1', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /workspaces/:workspaceId/members/:profileId/activate (2026-09-02 follow-up: switching bands/profiles moved into BandManagementView.tsx)', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('verifies the caller already holds a real account for this workspace, then always succeeds for a non-admin target, minting this device\'s own account', async () => {
      const fetchMock = stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        }, // verifyUser(caller)
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // getOrCreateAccessCode
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p2', id: 'p2' }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/activate',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'admin-pw', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json() as { username: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p2~device-1')
      expect(body.isAdmin).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    it('rejects a caller whose username does not belong to this workspace, without even checking their password', async () => {
      const fetchMock = stubFetch([])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/activate',
        payload: { callerUsername: 'stageboard-band-b-p1', callerPassword: 'whatever', password: undefined, deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a caller with the right username shape but wrong/stale credentials', async () => {
      const fetchMock = stubFetch([{ ok: false, status: 401 }]) // verifyUser(caller) fails

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p2/activate',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'wrong', password: undefined, deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('verifies an admin target\'s own self-assigned PIN against the anchor, once the caller verifies, then mints this device\'s own account', async () => {
      stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p2', roles: ['member'] } }),
        }, // verifyUser(caller)
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // getOrCreateAccessCode -> suffix '5678'
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        }, // verifyUser(target's own PIN, against the anchor)
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/activate',
        payload: { callerUsername: 'stageboard-band-a-p2', callerPassword: 'member-pw', password: '4711', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        username: 'stageboard-band-a-p1~device-1',
        password: expect.any(String),
        isAdmin: true,
      })
    })

    it('the universal recovery suffix works here too, once the caller verifies, minting this device\'s own fresh account', async () => {
      stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p2', roles: ['member'] } }),
        }, // verifyUser(caller)
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // getOrCreateAccessCode -> suffix '5678'
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/activate',
        payload: { callerUsername: 'stageboard-band-a-p2', callerPassword: 'member-pw', password: '5678', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json() as { username: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p1~device-1')
      expect(body.isAdmin).toBe(true)
    })

    it('rejects leaving the target password blank for an admin target, once the caller verifies', async () => {
      const fetchMock = stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p2', roles: ['member'] } }),
        }, // verifyUser(caller)
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // getOrCreateAccessCode
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', stageRoles: ['admin'] }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists(anchor) -> already provisioned
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/activate',
        payload: { callerUsername: 'stageboard-band-a-p2', callerPassword: 'member-pw', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(403)
      expect(fetchMock).toHaveBeenCalledTimes(4) // no device-provisioning calls after the admin check
    })

    it('auto-provisions a brand-new non-admin target (no anchor yet) plus this device\'s own account', async () => {
      stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        }, // verifyUser(caller)
        { ok: true, status: 200, json: async () => ({ code: '12345678', name: 'Band A' }) }, // getOrCreateAccessCode
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p3', id: 'p3' }) }, // getDoc profile
        { ok: false, status: 404 }, // userExists(anchor) -> not provisioned yet
        { ok: true, status: 201 }, // createUser(anchor)
        { ok: false, status: 404 }, // userExists(device)
        { ok: true, status: 201 }, // createUser(device)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p3/activate',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'admin-pw', deviceId: 'device-1' },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json() as { username: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p3~device-1')
      expect(body.isAdmin).toBe(false)
    })

    it('returns 400 for a body missing deviceId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/members/p1/activate',
        payload: { callerUsername: 'stageboard-band-a-p1', callerPassword: 'admin-pw' },
      })
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
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
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
      stubFetch([{ ok: false, status: 401 }])

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
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
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
      stubFetch([{ ok: false, status: 401 }])

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
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
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
      stubFetch([{ ok: false, status: 401 }])

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

    it('deletes the workspace (reading the roster, then the db, then every member) when the caller verifies as an admin', async () => {
      stubFetch([
        { ok: true, status: 200, json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }) },
        { ok: true, status: 200, json: async () => ({ rows: [{ doc: { _id: 'profiles:p1', id: 'p1' } }] }) }, // allDocs (roster)
        { ok: true, status: 200 }, // deleteDb
        { ok: true, status: 200, json: async () => ({ rows: [] }) }, // listDeviceUsernames(p1) -> none
        { ok: false, status: 404 }, // deleteUser(p1) anchor GET - not found is fine
      ])

      const response = await app.inject({
        method: 'DELETE',
        url: '/workspaces/band-a',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-admin-pw' },
      })

      expect(response.statusCode).toBe(204)
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 401 }])

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
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'http://localhost:5173' },
      })
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
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

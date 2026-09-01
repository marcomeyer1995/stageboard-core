import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, Server as HttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { ILookupPlugin, IShowControlPlugin, PluginContext } from 'shared-types'
import { buildApp } from './index.js'
import { __resetInviteStoreForTests, createInvite } from './inviteStore.js'
import { __resetHealthStoreForTests, getSnapshot, setEntry } from './plugins/healthStore.js'

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

    it('provisions a new workspace and returns the founder\'s own personal credential', async () => {
      stubFetch([
        { ok: false, status: 404 }, // userExists
        { ok: true, status: 201 }, // createUser (founder)
        { ok: true, status: 201 }, // ensureDb
        { ok: true, status: 200 }, // putSecurity
        { ok: true, status: 201 }, // putDoc (_design/roster)
      ])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { workspaceId: 'band-c', founderId: 'p1' },
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
        payload: { workspaceId: 'band-a', founderId: 'p1' },
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
        { ok: true, status: 200, json: async () => ({ _id: 'x', _rev: '1-a', name: 'x', type: 'user', roles: ['member'] }) }, // setUserRoles GET
        { ok: true, status: 200 }, // setUserRoles PUT
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
        { ok: true, status: 200, json: async () => ({ _id: 'x', _rev: '1-a', name: 'x', type: 'user', roles: ['member', 'admin'] }) },
        { ok: true, status: 200 },
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
        { ok: false, status: 404 }, // deleteUser GET - already gone is fine
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

    it('rotates the member\'s password and returns the fresh credentials - no last-admin check, unlike remove/demote', async () => {
      const fetchMock = stubFetch([
        stubAdminVerify(),
        // resetUserPassword: GET the existing user doc, then PUT it back with a new password.
        { ok: true, status: 200, json: async () => ({ _id: 'org.couchdb.user:stageboard-band-a-p2', _rev: '1-abc', name: 'stageboard-band-a-p2', roles: ['member'], type: 'user' }) },
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
      expect(body.password).toEqual(expect.any(String))

      // The PUT carries the new password, keeping every other field (roles included) intact.
      const [, putInit] = fetchMock.mock.calls[2]
      const putBody = JSON.parse((putInit as RequestInit).body as string)
      expect(putBody.password).toBe(body.password)
      expect(putBody.roles).toEqual(['member'])
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

  describe('POST /workspaces/:workspaceId/invite (2026-09-01 redesign: workspace-level, not per-person)', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    beforeEach(() => {
      __resetInviteStoreForTests()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('mints a workspace-level invite when the caller verifies as an admin', async () => {
      stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        },
      ])

      const inviteResponse = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/invite',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'correct-admin-pw', workspaceName: 'Band A' },
      })

      expect(inviteResponse.statusCode).toBe(201)
      const { code, expiresAt } = inviteResponse.json()
      expect(code).toMatch(/^\d{8}$/)
      expect(expiresAt).toBeGreaterThan(Date.now())
    })

    it('returns 403 when the caller does not verify as an admin', async () => {
      stubFetch([{ ok: false, status: 401 }])

      const response = await app.inject({
        method: 'POST',
        url: '/workspaces/band-a/invite',
        payload: { adminUsername: 'stageboard-band-a-p1', adminPassword: 'wrong-pw', workspaceName: 'Band A' },
      })

      expect(response.statusCode).toBe(403)
    })

    it('returns 400 for a body that fails schema validation', async () => {
      const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/invite', payload: {} })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('POST /invites/:code/roster', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    beforeEach(() => {
      __resetInviteStoreForTests()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('resolves the roster, computing requiresPassword per member from whether an account already exists', async () => {
      const { code } = createInvite('band-a', 'Band A')
      stubFetch([
        {
          ok: true,
          status: 200,
          json: async () => ({
            rows: [
              { doc: { _id: 'profiles:p1', id: 'p1', name: 'Marco', role: 'Gitarre' } },
              { doc: { _id: 'profiles:p2', id: 'p2', name: 'Chris', role: 'Bass' } },
            ],
          }),
        }, // allDocs (roster)
        { ok: true, status: 200 }, // userExists(p1) -> already provisioned
        { ok: false, status: 404 }, // userExists(p2) -> not provisioned yet
      ])

      const response = await app.inject({ method: 'POST', url: `/invites/${code}/roster` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        workspaceId: 'band-a',
        workspaceName: 'Band A',
        members: [
          { profileId: 'p1', name: 'Marco', role: 'Gitarre', requiresPassword: true },
          { profileId: 'p2', name: 'Chris', role: 'Bass', requiresPassword: false },
        ],
      })
    })

    it('returns 404 for an unknown or expired code', async () => {
      const response = await app.inject({ method: 'POST', url: '/invites/00000000/roster' })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('POST /invites/:code/join/:profileId', () => {
    function stubFetch(responses: Array<Partial<Response>>) {
      const fetchMock = vi.fn()
      for (const response of responses) fetchMock.mockResolvedValueOnce(response as Response)
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    beforeEach(() => {
      __resetInviteStoreForTests()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('auto-provisions a brand-new member (no account yet) and returns fresh, never-admin credentials', async () => {
      const { code } = createInvite('band-a', 'Band A')
      stubFetch([
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p2', id: 'p2', name: 'Chris' }) }, // getDoc profile
        { ok: false, status: 404 }, // userExists -> not provisioned
        { ok: true, status: 201 }, // createUser
      ])

      const response = await app.inject({ method: 'POST', url: `/invites/${code}/join/p2`, payload: {} })

      expect(response.statusCode).toBe(201)
      const body = response.json() as { username: string; password: string; isAdmin: boolean }
      expect(body.username).toBe('stageboard-band-a-p2')
      expect(body.password).toEqual(expect.any(String))
      expect(body.isAdmin).toBe(false)
    })

    it('verifies the supplied password against an already-provisioned account and echoes back matching credentials', async () => {
      const { code } = createInvite('band-a', 'Band A')
      stubFetch([
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1', name: 'Marco' }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists -> already provisioned
        {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, userCtx: { name: 'stageboard-band-a-p1', roles: ['member', 'admin'] } }),
        }, // verifyUser
      ])

      const response = await app.inject({ method: 'POST', url: `/invites/${code}/join/p1`, payload: { password: 'correct-pw' } })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ username: 'stageboard-band-a-p1', password: 'correct-pw', isAdmin: true })
    })

    it('returns 400 when the account already exists but no password was supplied', async () => {
      const { code } = createInvite('band-a', 'Band A')
      stubFetch([
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1' }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists -> already provisioned
      ])

      const response = await app.inject({ method: 'POST', url: `/invites/${code}/join/p1`, payload: {} })

      expect(response.statusCode).toBe(400)
    })

    it('returns 403 for a wrong password against an already-provisioned account', async () => {
      const { code } = createInvite('band-a', 'Band A')
      stubFetch([
        { ok: true, status: 200, json: async () => ({ _id: 'profiles:p1', id: 'p1' }) }, // getDoc profile
        { ok: true, status: 200 }, // userExists -> already provisioned
        { ok: false, status: 401 }, // verifyUser fails
      ])

      const response = await app.inject({ method: 'POST', url: `/invites/${code}/join/p1`, payload: { password: 'wrong' } })

      expect(response.statusCode).toBe(403)
    })

    it('returns 404 for a profileId with no matching roster entry', async () => {
      const { code } = createInvite('band-a', 'Band A')
      stubFetch([{ ok: false, status: 404 }]) // getDoc profile -> not found

      const response = await app.inject({ method: 'POST', url: `/invites/${code}/join/ghost`, payload: {} })

      expect(response.statusCode).toBe(404)
    })

    it('returns 404 for an unknown or expired invite code', async () => {
      const response = await app.inject({ method: 'POST', url: '/invites/00000000/join/p1', payload: {} })
      expect(response.statusCode).toBe(404)
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
        { ok: false, status: 404 }, // deleteUser(p1) GET - not found is fine
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

import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { ILookupPlugin, IShowControlPlugin, PluginContext } from 'shared-types'
import { buildApp } from './index.js'
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

      const req = httpsRequest(
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

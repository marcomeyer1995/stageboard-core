import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { ILookupPlugin, IShowControlPlugin, PluginContext } from 'shared-types'
import { buildApp } from './index.js'

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

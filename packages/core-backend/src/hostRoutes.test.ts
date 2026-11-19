import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { createHostRoutes, type HostRoutesDeps } from 'sync-host'
import { registerHostRoutes } from './hostRoutes.js'

function build(over: Partial<HostRoutesDeps> = {}) {
  const files = new Map<string, Uint8Array>()
  const deps: HostRoutesDeps = {
    hostId: 'laptop',
    lease: {
      bandTime: () => 42,
      epoch: () => 3,
      isBandHost: () => true,
      isActive: () => false,
      outdated: () => false,
      status: () => null,
      clockOffsetMs: () => null,
      receive: vi.fn(async () => 'ignored' as const),
    },
    activeWorkspaceId: () => 'band',
    acceptInvite: async () => ({ ok: true as const }),
    issueAccount: async () => null,
    audio: {
      get: async (v, t) => files.get(`${v}/${t}`) ?? null,
      put: async (v, t, d) => void files.set(`${v}/${t}`, d),
      remove: async (v, t) => void files.delete(`${v}/${t}`),
    },
    presence: { report: vi.fn(() => true), heartbeat: vi.fn(() => true) },
    ...over,
  }
  const app = Fastify()
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => done(null, payload))
  registerHostRoutes(app, createHostRoutes(deps))
  return { app, deps }
}

describe('the shared host routes on Fastify (#949)', () => {
  it('answers a shared route with its status and JSON', async () => {
    const { app } = build()
    const res = await app.inject({ method: 'GET', url: '/time' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ serverTime: 42, hostId: 'laptop', epoch: 3, active: true })
  })

  it('sends an empty 403 and an empty 204 as they are', async () => {
    const { app } = build()
    expect((await app.inject({ method: 'POST', url: '/host/replication-account', payload: {} })).statusCode).toBe(403)
    const beat = await app.inject({ method: 'POST', url: '/workspaces/band/master-heartbeat', payload: { deviceId: 'fire' } })
    expect(beat.statusCode).toBe(204)
    expect(beat.body).toBe('')
  })

  it('takes an upload as bytes and sends the track back as bytes, whatever the content type', async () => {
    const { app } = build()
    const bytes = Buffer.from([0, 1, 2, 250, 255])
    expect((await app.inject({ method: 'PUT', url: '/audio/var1/trk1', headers: { 'content-type': 'audio/wav' }, payload: bytes })).statusCode).toBe(204)
    const got = await app.inject({ method: 'GET', url: '/audio/var1/trk1' })
    expect(got.statusCode).toBe(200)
    expect(got.headers['content-type']).toBe('application/octet-stream')
    expect(Buffer.from(got.rawPayload)).toEqual(bytes)
    expect((await app.inject({ method: 'GET', url: '/audio/var1/none' })).statusCode).toBe(404)
  })

  it('refuses an id that is only unsafe once it is decoded', async () => {
    const { app } = build()
    expect((await app.inject({ method: 'GET', url: '/audio/var1/a%2Fb' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/audio/%2e%2e/trk1' })).statusCode).toBe(404) // never reaches the handler: the router folds the path
    expect((await app.inject({ method: 'GET', url: '/audio/var1/a%00b' })).statusCode).toBe(400)
  })

  it('passes the band of a presence report on as the path names it, and says 400 for a bad body', async () => {
    const { app, deps } = build()
    await app.inject({ method: 'POST', url: '/workspaces/band-a/presence/report', payload: { deviceId: 'd', profileId: 'p' } })
    expect(deps.presence.report).toHaveBeenCalledWith('band-a', { deviceId: 'd', profileId: 'p' })
    const bad = await app.inject({ method: 'POST', url: '/workspaces/band-a/presence/report', payload: { deviceId: 'd' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().status).toBe('error')
  })

  it('passes the headers of an answer on (Retry-After of a locked PIN)', async () => {
    const { app } = build({ joinBand: () => ({ join: async () => ({ status: 429, body: { status: 'error' }, headers: { 'Retry-After': '42' } }), become: async () => ({ status: 200, body: {} }), verifyPin: async () => ({ status: 200, body: {} }) }) })
    const response = await app.inject({ method: 'POST', url: '/workspaces/band-a/join/p1', payload: { code: 'x', deviceId: 'd' } })
    expect(response.statusCode).toBe(429)
    expect(response.headers['retry-after']).toBe('42')
  })
})

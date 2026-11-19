import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { createHostDeviceInfo, createHostPresence, createHostRoutes, type HostRoutesDeps } from 'sync-host'
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
    presence: createHostPresence({ now: () => 1_000, newId: () => 'f1' }),
    deviceInfo: createHostDeviceInfo({ now: () => 1_000 }),
    band: { accessCode: async () => ({ code: '12345678', name: 'Band A' }), profileDocs: async () => [{ _id: 'profiles:p', id: 'p', name: 'Anna', stageRoles: ['admin'] }] },
    isBandDevice: async (_ws: string, authorization: string | undefined) => authorization === 'Basic good',
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
    expect(deps.presence.snapshot('band-a').devices).toEqual({ d: { profileId: 'p', lastSeenAt: 1_000 } })
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

  it('reads the login from the Authorization header: a flash message from a stranger is 401, from a device of the band 201', async () => {
    const { app } = build()
    expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/flash', payload: { text: 'Pause' } })).statusCode).toBe(401)
    const sent = await app.inject({ method: 'POST', url: '/workspaces/band-a/flash', headers: { authorization: 'Basic good' }, payload: { text: 'Pause', from: 'Anna' } })
    expect(sent.statusCode).toBe(201)
    expect(sent.json()).toMatchObject({ id: 'f1', text: 'Pause', from: 'Anna' })
  })

  it('stamps a device report with the address the request came from, not one the client names', async () => {
    const { app, deps } = build()
    expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/device-info/report', remoteAddress: '10.9.8.7', payload: { deviceId: 'd', os: 'iPad', environment: 'browser', syncStatus: 'idle', ip: '1.2.3.4' } })).statusCode).toBe(204)
    expect(deps.deviceInfo.snapshot('band-a').devices.d!.ip).toBe('10.9.8.7')
    const list = await app.inject({ method: 'GET', url: '/workspaces/band-a/device-info' })
    expect(list.json().devices.d.os).toBe('iPad')
  })

  it('answers the roster to a device that knows the code, and 403 to one that does not', async () => {
    const { app } = build()
    const ok = await app.inject({ method: 'POST', url: '/workspaces/band-a/roster', payload: { code: '12345678' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ workspaceId: 'band-a', workspaceName: 'Band A', members: [{ profileId: 'p', name: 'Anna', isAdmin: true }] })
    expect((await app.inject({ method: 'POST', url: '/workspaces/band-a/roster', payload: { code: 'nope' } })).statusCode).toBe(403)
  })
})

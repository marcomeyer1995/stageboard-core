import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createSocket } from 'node:dgram'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCapabilities } from './capabilities.js'

let allowed: Server
let evil: Server
let allowedOrigin: string
let evilOrigin: string
const evilHits: string[] = []
const allowedHits: { url: string; headers: Record<string, string | string[] | undefined> }[] = []

const listen = async (server: Server) => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeAll(async () => {
  evil = createServer((req, res) => (evilHits.push(req.url ?? ''), res.end('evil')))
  evilOrigin = await listen(evil)
  allowed = createServer((req, res) => {
    allowedHits.push({ url: req.url ?? '', headers: req.headers })
    if (req.url === '/redirect') return void ((res.statusCode = 302), res.setHeader('Location', `${evilOrigin}/stolen`), res.end())
    if (req.url === '/big') return void res.end(Buffer.alloc(8 * 1024 * 1024 + 1, 1))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ hello: 'world' }))
  })
  allowedOrigin = await listen(allowed)
})
afterAll(() => void (allowed.close(), evil.close()))

const caps = (permissions: string[]) => createCapabilities({ permissions, helpers: async () => ({ result: {}, files: [] }) })

describe('capability.http - StageBoard performs the request, only to declared origins (#964)', () => {
  it('fetches from an allowed origin and returns status, headers and the body as text', async () => {
    const result = await caps([`http:${allowedOrigin}`])('capability.http', { url: `${allowedOrigin}/x`, headers: { 'User-Agent': 'StageBoard/test' } })
    expect(result).toMatchObject({ ok: true, body: { status: 200, body: '{"hello":"world"}' } })
    expect(allowedHits.at(-1)?.headers['user-agent']).toBe('StageBoard/test')
  })

  it('denies every other origin and sends nothing: another host, a different scheme, userinfo tricks, a bad URL', async () => {
    const run = caps([`http:${allowedOrigin}`])
    const [, port] = allowedOrigin.split('127.0.0.1:')
    for (const url of [`${evilOrigin}/a`, `https://127.0.0.1:${port}/a`, `http://${allowedOrigin.slice(7)}@127.0.0.1:${evilOrigin.split(':')[2]}/a`, `http://127.0.0.1:${port}@127.0.0.1:${evilOrigin.split(':')[2]}/a`, 'not a url', 'file:///etc/passwd']) {
      const result = await run('capability.http', { url })
      expect(result, url).toMatchObject({ ok: false, error: { code: 'permission.denied' } })
    }
    expect(evilHits).toEqual([])
  })

  it('does not follow a redirect to another origin - the target is checked too, nothing reaches it', async () => {
    const result = await caps([`http:${allowedOrigin}`])('capability.http', { url: `${allowedOrigin}/redirect` })
    expect(result).toMatchObject({ ok: false, error: { code: 'permission.denied', params: { capability: 'http' } } })
    expect(evilHits).toEqual([])
  })

  it('follows a redirect that stays inside an allowed origin', async () => {
    const result = await caps([`http:${allowedOrigin}`, `http:${evilOrigin}`])('capability.http', { url: `${allowedOrigin}/redirect` })
    expect(result).toMatchObject({ ok: true, body: { body: 'evil' } })
  })

  it('refuses a body above 8 MB', async () => {
    expect(await caps([`http:${allowedOrigin}`])('capability.http', { url: `${allowedOrigin}/big` })).toMatchObject({ ok: false, error: { code: 'http.too-large' } })
  })

  it('an add-on with no http permission at all gets nothing', async () => {
    expect(await caps([])('capability.http', { url: `${allowedOrigin}/x` })).toMatchObject({ ok: false, error: { code: 'permission.denied' } })
  })

  it('a malformed request body is an error, not a crash', async () => {
    expect(await caps([`http:${allowedOrigin}`])('capability.http', { nope: 1 })).toMatchObject({ ok: false, error: { code: 'capability.invalid' } })
  })
})

describe('capability.udp and capability.helper', () => {
  it('sends one datagram only to a declared host:port', async () => {
    const receiver = createSocket('udp4')
    const got = new Promise<Buffer>((r) => receiver.once('message', r))
    await new Promise<void>((r) => receiver.bind(0, '127.0.0.1', r))
    const port = (receiver.address() as AddressInfo).port
    const run = caps([`udp:127.0.0.1:${port}`])
    expect(await run('capability.udp', { host: '127.0.0.1', port, bytes: new Uint8Array([1, 2, 3]) })).toMatchObject({ ok: true })
    expect([...(await got)]).toEqual([1, 2, 3])
    expect(await run('capability.udp', { host: '127.0.0.1', port: port + 1, bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, error: { code: 'permission.denied' } })
    expect(await caps([`osc:127.0.0.1:${port}`])('capability.udp', { host: '127.0.0.1', port, bytes: new Uint8Array([9]) })).toMatchObject({ ok: true })
    receiver.close()
  })

  it('runs only a helper the add-on has the permission for', async () => {
    const seen: string[] = []
    const run = createCapabilities({ permissions: ['helper:yt-dlp'], helpers: async (helper) => (seen.push(helper), { result: { ok: 1 }, files: [] }) })
    expect(await run('capability.helper', { helper: 'yt-dlp', args: [], files: [] })).toMatchObject({ ok: true, body: { result: { ok: 1 } } })
    expect(await run('capability.helper', { helper: 'rm', args: [], files: [] })).toMatchObject({ ok: false, error: { code: 'permission.denied' } })
    expect(seen).toEqual(['yt-dlp'])
  })

  it('an unknown capability is refused with its name', async () => {
    expect(await caps([])('capability.teleport', {})).toMatchObject({ ok: false, error: { code: 'capability.unknown' } })
  })
})

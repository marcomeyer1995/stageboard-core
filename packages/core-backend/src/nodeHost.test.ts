import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { request, type Server as HttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pino } from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostRequest } from 'sync-host'
import { createNodeHost, type NodeHost } from './nodeHost.js'

const quiet = pino({ level: 'silent' })
let open: NodeHost[] = []
afterEach(async () => {
  await Promise.all(open.map((host) => host.close()))
  open = []
})

function host(options: { bodyLimit?: number; files?: string } = {}) {
  const seen: HostRequest[] = []
  const app = createNodeHost({ bodyLimit: options.bodyLimit ?? 1024, corsOrigin: (origin) => origin === 'https://app.example', log: quiet })
  app.setHandler(async (req) => {
    seen.push(req)
    if (req.path === '/stream') return { status: 200, body: null, stream: (send) => (send({ hello: 1 }), () => undefined) }
    if (req.path === '/boom') throw new Error('kaputt')
    if (req.path === '/text') return { status: 200, body: 'plain' }
    if (req.path === '/empty') return { status: 204, body: undefined }
    return { status: 200, body: { path: req.path, query: req.query, body: req.body ?? null }, headers: { 'X-Seen': '1' } }
  })
  if (options.files) app.serveFiles(options.files)
  open.push(app)
  return { app, seen }
}

const build = () => {
  const dir = mkdtempSync(join(tmpdir(), 'nodehost-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<html>app</html>')
  writeFileSync(join(dir, 'assets', 'a.js'), 'console.log(1)')
  return dir
}

describe('the Node host listener (#964 step 3)', () => {
  it('hands a request to the pipeline with its path, query, parsed JSON body and headers back', async () => {
    const { app, seen } = host()
    const res = await app.inject({ method: 'POST', url: '/x/y?a=1&a=2&b=%20', payload: { n: 1 }, headers: { Authorization: 'Basic abc' } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-seen']).toBe('1')
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.json()).toEqual({ path: '/x/y', query: { a: '1', b: ' ' }, body: { n: 1 } })
    expect(seen[0]).toMatchObject({ authorization: 'Basic abc', remoteAddress: '127.0.0.1', contentType: 'application/json' })
  })

  it('takes an upload as its bytes, text as text, and no body as none', async () => {
    const { app, seen } = host()
    await app.inject({ method: 'PUT', url: '/u', payload: Buffer.from([1, 2, 3]), headers: { 'content-type': 'audio/wav' } })
    await app.inject({ method: 'POST', url: '/t', payload: 'hi', headers: { 'content-type': 'text/plain' } })
    await app.inject({ method: 'GET', url: '/n' })
    expect(Buffer.isBuffer(seen[0]!.body) && [...(seen[0]!.body as Buffer)]).toEqual([1, 2, 3])
    expect(seen[1]!.body).toBe('hi')
    expect(seen[2]!.body).toBeUndefined()
  })

  it('refuses broken JSON with 400 and answers a failing handler with 500, never crashing', async () => {
    const { app } = host()
    const bad = await app.inject({ method: 'POST', url: '/x', payload: '{x', headers: { 'content-type': 'application/json' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ error: 'Bad Request' })
    const boom = await app.inject({ url: '/boom' })
    expect(boom.statusCode).toBe(500)
    expect(boom.json()).toMatchObject({ error: 'Internal Server Error', message: 'kaputt' })
    expect((await app.inject({ url: '/text' })).headers['content-type']).toBe('text/plain; charset=utf-8')
    expect((await app.inject({ url: '/empty' })).body).toBe('')
  })

  it('gives an allowed origin CORS with credentials and every method at the preflight; another origin nothing', async () => {
    const { app } = host()
    const pre = await app.inject({ method: 'OPTIONS', url: '/db/x', headers: { origin: 'https://app.example', 'access-control-request-method': 'DELETE', 'access-control-request-headers': 'authorization' } })
    expect(pre.statusCode).toBe(204)
    expect(pre.headers).toMatchObject({ 'access-control-allow-origin': 'https://app.example', 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET, HEAD, PUT, POST, DELETE, PATCH', 'access-control-allow-headers': 'authorization' })
    expect((await app.inject({ url: '/x', headers: { origin: 'https://app.example' } })).headers['access-control-allow-origin']).toBe('https://app.example')
    expect((await app.inject({ url: '/x', headers: { origin: 'https://evil.example' } })).headers['access-control-allow-origin']).toBeUndefined()
    expect((await app.inject({ method: 'OPTIONS', url: '/x' })).statusCode).toBe(400)
  })

  it('serves the app\'s files (index at /, 304 on its ETag), a new build\'s file without a restart, and nothing outside the build', async () => {
    const dir = build()
    const { app, seen } = host({ files: dir })
    const index = await app.inject({ url: '/' })
    expect(index.statusCode).toBe(200)
    expect(index.body).toBe('<html>app</html>')
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8')
    expect((await app.inject({ url: '/', headers: { 'if-none-match': index.headers.etag! } })).statusCode).toBe(304)
    expect((await app.inject({ url: '/assets/a.js' })).headers['content-type']).toBe('application/javascript; charset=utf-8')
    // A new build after the start: read again on the miss (a frontend change needs no restart, docs/03).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 5_000)
    writeFileSync(join(dir, 'assets', 'b.js'), 'console.log(2)')
    expect((await app.inject({ url: '/assets/b.js' })).body).toBe('console.log(2)')
    vi.useRealTimers()
    // Outside the build, or not a file of it: the pipeline's.
    expect((await app.inject({ url: '/../package.json' })).json()).toMatchObject({ path: '/../package.json' })
    expect((await app.inject({ url: '/%2e%2e/package.json' })).json()).toMatchObject({ path: '/%2e%2e/package.json' })
    expect((await app.inject({ url: '/time' })).json()).toMatchObject({ path: '/time' })
    expect(seen.map((r) => r.path)).toEqual(['/../package.json', '/%2e%2e/package.json', '/time'])
  })

  it('on a socket: refuses a body over the limit with 413, opens a stream with its headers at once, and closes with the stream open', async () => {
    const { app } = host({ bodyLimit: 10 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const tooBig = await new Promise<number>((done) => {
      const req = request({ port, method: 'PUT', path: '/u', headers: { 'content-type': 'audio/wav' } }, (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      })
      req.on('error', () => done(-1))
      req.end(Buffer.alloc(100))
    })
    expect(tooBig).toBe(413)
    const first = await new Promise<{ type: string | undefined; data: string }>((done) => {
      request({ port, path: '/stream' }, (res) => res.once('data', (chunk: Buffer) => done({ type: res.headers['content-type'], data: chunk.toString() }))).end()
    })
    expect(first).toEqual({ type: 'text/event-stream', data: 'data: {"hello":1}\n\n' })
    const closed = vi.fn()
    app.addHook('onClose', closed)
    // Without certificates the host is plain HTTP/1.1: drop the open stream as main() does with its connection tracking.
    app.addHook('preClose', () => (app.server as HttpServer).closeAllConnections())
    await app.close()
    expect(closed).toHaveBeenCalledOnce()
  })
})

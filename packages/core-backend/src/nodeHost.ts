import { createReadStream } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { createSecureServer, type Http2SecureServer, type Http2ServerRequest, type Http2ServerResponse } from 'node:http2'
import { extname, resolve, sep } from 'node:path'
import { pino, type Logger } from 'pino'
import type { HostAnswer, HostRequest, HostStream } from 'sync-host'

/**
 * The Node host's own listener (#964 step 3): what Fastify did for the laptop, without Fastify. Every request goes through one pipeline -
 * CORS, the app's files, body parsing, then the host (`answerHostRequest`) - and the answer is written as JSON, bytes or a live stream
 * (server-sent events). HTTPS is HTTP/2 with HTTP/1.1 kept for clients that do not negotiate h2 (#129); without certificates plain HTTP.
 *
 * It keeps the shape the code and its tests knew from Fastify: `log` (pino, the same JSON lines), `server`, `addHook('preClose' | 'onClose')`,
 * `listen`, `close`, and `inject` - a request answered in-process without a socket, as the tests send it.
 */
export interface NodeHostOptions {
  /** Certificate and key: HTTP/2 over TLS. Absent: plain HTTP/1.1. */
  https?: { cert: Buffer; key: Buffer }
  /** Largest request body; a larger one is refused with 413. */
  bodyLimit: number
  /** Whether a page of `origin` may call this host from another origin (the tablets' own app origins, #926). */
  corsOrigin: (origin: string) => boolean
  /** A pino logger; default: one to stdout, as Fastify's `logger: true`. */
  log?: Logger
}

export interface InjectRequest {
  method?: string
  url: string
  headers?: Record<string, string>
  /** An object is sent as JSON; a string or Buffer as it is. */
  payload?: unknown
  remoteAddress?: string
}

export interface InjectResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  payload: string
  rawPayload: Buffer
  /** The body as JSON - any shape, as the tests read it. */
  json: () => any
}

type Hook = () => Promise<void> | void

/** What a request becomes after CORS, files and the host: bytes with a status, or a stream. */
type Outgoing = { kind: 'bytes'; status: number; headers: Record<string, string>; body?: Buffer } | { kind: 'stream'; headers: Record<string, string>; stream: HostStream }

interface Incoming {
  method: string
  url: string
  headers: Record<string, string | undefined>
  body: Buffer
  remoteAddress: string
  signal?: AbortSignal
}

const CORS_METHODS = 'GET, HEAD, PUT, POST, DELETE, PATCH'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

export class NodeHost {
  readonly log: Logger
  readonly server: Http2SecureServer | HttpServer
  private handler: ((request: HostRequest) => Promise<HostAnswer>) | null = null
  /** The app's files by request path. Read again when a file-like path is missing (a new frontend build needs no restart, docs/03). */
  private files = new Map<string, string>()
  private filesRoot: string | null = null
  private filesReadAt = 0
  private readonly preClose: Hook[] = []
  private readonly onClose: Hook[] = []
  private requestCount = 0
  private closed = false

  constructor(private readonly options: NodeHostOptions) {
    this.log = options.log ?? pino()
    const listener = (req: IncomingMessage | Http2ServerRequest, res: ServerResponse | Http2ServerResponse) => void this.serve(req, res)
    this.server = options.https ? createSecureServer({ allowHTTP1: true, cert: options.https.cert, key: options.https.key }, listener) : createHttpServer(listener)
  }

  /** The host pipeline every request without a file goes to. */
  setHandler(handler: (request: HostRequest) => Promise<HostAnswer>): void {
    this.handler = handler
  }

  /** Serve the app's build from `root` (`/` is its `index.html`): the files it has; every other path is the pipeline's. */
  serveFiles(root: string): void {
    this.filesRoot = resolve(root)
    this.readFiles()
  }

  private readFiles(): void {
    const base = this.filesRoot
    if (!base) return
    const files = new Map<string, string>()
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.isFile()) files.set(full.slice(base.length).split(sep).join('/'), full)
      }
    }
    try {
      walk(base)
    } catch {
      // A build being replaced right now: keep what was there, read again on the next miss.
      return
    }
    const index = files.get('/index.html')
    if (index) files.set('/', index)
    this.files = files
    this.filesReadAt = Date.now()
  }

  addHook(name: 'preClose' | 'onClose', hook: Hook): void {
    ;(name === 'preClose' ? this.preClose : this.onClose).push(hook)
  }

  async listen(options: { port: number; host?: string }): Promise<string> {
    await new Promise<void>((done, fail) => {
      this.server.once('error', fail)
      // Without a host only this machine (IPv4 loopback; `localhost` may resolve to ::1 only). The real host passes 0.0.0.0.
      this.server.listen(options.port, options.host ?? '127.0.0.1', () => {
        this.server.off('error', fail)
        done()
      })
    })
    const address = this.server.address()
    const where = typeof address === 'object' && address ? `${this.options.https ? 'https' : 'http'}://${address.address}:${address.port}` : String(address)
    this.log.info(`Server listening at ${where}`)
    return where
  }

  /** Stops taking requests, waits for the open ones, then runs the close hooks (each once, in order; a failing one is logged). */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const hook of this.preClose) await this.runHook(hook)
    if (this.server.listening) await new Promise<void>((done) => this.server.close(() => done()))
    for (const hook of this.onClose) await this.runHook(hook)
  }

  /** A request answered in-process, without a socket (the tests). A stream answers its headers and is closed at once. */
  async inject(input: InjectRequest | string): Promise<InjectResponse> {
    const request = typeof input === 'string' ? { url: input } : input
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(request.headers ?? {})) headers[name.toLowerCase()] = value
    let body = Buffer.alloc(0)
    if (request.payload !== undefined) {
      if (Buffer.isBuffer(request.payload)) body = request.payload
      else if (typeof request.payload === 'string') body = Buffer.from(request.payload)
      else {
        body = Buffer.from(JSON.stringify(request.payload))
        headers['content-type'] ??= 'application/json'
      }
    }
    const out = await this.dispatch({ method: (request.method ?? 'GET').toUpperCase(), url: request.url, headers, body, remoteAddress: request.remoteAddress ?? '127.0.0.1' })
    if (out.kind === 'stream') out.stream(() => undefined)()
    const raw = out.kind === 'bytes' ? (out.body ?? Buffer.alloc(0)) : Buffer.alloc(0)
    const responseHeaders = out.kind === 'bytes' ? { ...out.headers, ...(out.body ? { 'content-length': String(out.body.length) } : {}) } : out.headers
    const text = raw.toString('utf8')
    return { statusCode: out.kind === 'bytes' ? out.status : 200, headers: responseHeaders, body: text, payload: text, rawPayload: raw, json: () => JSON.parse(text) }
  }

  private async runHook(hook: Hook): Promise<void> {
    try {
      await hook()
    } catch (err) {
      this.log.error({ err }, 'A close hook failed')
    }
  }

  /** A request on the socket: read the body, answer it, write the answer, log both ends as Fastify did. */
  private async serve(req: IncomingMessage | Http2ServerRequest, response: ServerResponse | Http2ServerResponse): Promise<void> {
    // The h1 and h2 responses have the same methods with signatures TypeScript cannot unite: the part used here.
    const res = response as unknown as { writeHead: (status: number, headers: Record<string, string>) => void; write: (chunk: string) => void; end: (body?: Buffer) => void; on: (event: 'close', listener: () => void) => void; flushHeaders?: () => void }
    const started = process.hrtime.bigint()
    const reqId = `req-${++this.requestCount}`
    const remoteAddress = req.socket?.remoteAddress ?? ''
    const url = req.url ?? '/'
    const method = (req.method ?? 'GET').toUpperCase()
    this.log.info({ reqId, req: { method, url, host: req.headers[':authority'] ?? req.headers.host, remoteAddress, remotePort: req.socket?.remotePort } }, 'incoming request')
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    let out: Outgoing
    try {
      const body = await readBody(req, this.options.bodyLimit)
      out = await this.dispatch({ method, url, headers: flatHeaders(req.headers), body, remoteAddress, signal: abort.signal })
    } catch (err) {
      out = this.failure(err, reqId)
    }
    if (out.kind === 'stream') {
      const http1 = req.httpVersionMajor < 2
      // HTTP/2 forbids connection-specific headers (RFC 7540 §8.1.2.2) and Node's h2 layer throws on one: only for an HTTP/1.x client.
      res.writeHead(200, { ...out.headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...(http1 ? { connection: 'keep-alive' } : {}) })
      // The headers go out now, not with the first message: a device sees the stream is open.
      res.flushHeaders?.()
      const unsubscribe = out.stream((payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`))
      req.on('close', unsubscribe)
      return
    }
    const headers = out.body && method !== 'HEAD' ? { ...out.headers, 'content-length': String(out.body.length) } : out.headers
    res.writeHead(out.status, headers)
    if (out.body && method !== 'HEAD' && out.status !== 204 && out.status !== 304) res.end(out.body)
    else res.end()
    const responseTime = Number(process.hrtime.bigint() - started) / 1e6
    this.log.info({ reqId, res: { statusCode: out.status }, responseTime }, 'request completed')
  }

  private failure(err: unknown, reqId: string): Outgoing {
    if (err instanceof HttpError) return jsonOut(err.status, { statusCode: err.status, ...(err.code ? { code: err.code } : {}), error: err.error, message: err.message }, {})
    this.log.error({ reqId, err }, 'Request failed')
    return jsonOut(500, { statusCode: 500, error: 'Internal Server Error', message: err instanceof Error ? err.message : String(err) }, {})
  }

  /** CORS, then a file of the app, then the host pipeline. */
  private async dispatch(request: Incoming): Promise<Outgoing> {
    const cors = this.corsHeaders(request.headers.origin)
    if (request.method === 'OPTIONS') return this.preflight(request, cors)
    try {
      const path = request.url.split('?')[0] ?? '/'
      if (this.filesRoot && (request.method === 'GET' || request.method === 'HEAD')) {
        const file = await this.fileOf(path, request.headers, cors)
        if (file) return file
      }
      if (!this.handler) return jsonOut(404, { error: 'not_found', reason: 'Not a route of this host.' }, cors)
      const answer = await this.handler(hostRequestOf(request, path))
      return outgoingOf(answer, cors)
    } catch (err) {
      const out = this.failure(err, '')
      return out.kind === 'bytes' ? { ...out, headers: { ...out.headers, ...cors } } : out
    }
  }

  /** The headers a cross-origin page needs (credentials: PouchDB sends its Basic login with `credentials: 'include'`). */
  private corsHeaders(origin: string | undefined): Record<string, string> {
    if (!origin || !this.options.corsOrigin(origin)) return {}
    return { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' }
  }

  /**
   * A browser's preflight: every method the host has (a default of GET/HEAD/POST blocked every PUT/DELETE at the preflight, found live
   * 2026-08-30) and whatever headers it asks for.
   */
  private preflight(request: Incoming, cors: Record<string, string>): Outgoing {
    if (!request.headers.origin || !request.headers['access-control-request-method']) {
      return { kind: 'bytes', status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: Buffer.from('Invalid Preflight Request') }
    }
    if (!cors['access-control-allow-origin']) return { kind: 'bytes', status: 204, headers: {} }
    const asked = request.headers['access-control-request-headers']
    return {
      kind: 'bytes',
      status: 204,
      headers: { ...cors, vary: 'Origin, Access-Control-Request-Headers', 'access-control-allow-methods': CORS_METHODS, ...(asked ? { 'access-control-allow-headers': asked } : {}), 'content-length': '0' },
    }
  }

  /** A file of the app's build, or null when the path names none (then the pipeline answers it). */
  private async fileOf(path: string, headers: Record<string, string | undefined>, cors: Record<string, string>): Promise<Outgoing | null> {
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      return null
    }
    let file = this.files.get(decoded)
    let info = file ? statSync(file, { throwIfNoEntry: false }) : undefined
    // A file the list does not have (yet), or one a new build removed: read the build again, at most once a second. Only for a path
    // that looks like a file - an API path (`/time`, `/audio/<v>/<t>`) never makes the host read the disk.
    if (!info?.isFile() && /\.[a-z0-9]+$/i.test(decoded) && Date.now() - this.filesReadAt > 1000) {
      this.readFiles()
      file = this.files.get(decoded)
      info = file ? statSync(file, { throwIfNoEntry: false }) : undefined
    }
    if (!file || !info?.isFile()) return null
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
    const fileHeaders = { ...cors, 'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', etag, 'last-modified': info.mtime.toUTCString(), 'cache-control': 'public, max-age=0' }
    if (headers['if-none-match'] === etag) return { kind: 'bytes', status: 304, headers: fileHeaders }
    return { kind: 'bytes', status: 200, headers: fileHeaders, body: await readFile(file) }
  }
}

/** Builds the Node host. */
export function createNodeHost(options: NodeHostOptions): NodeHost {
  return new NodeHost(options)
}

const flatHeaders = (headers: IncomingMessage['headers']): Record<string, string | undefined> => {
  const flat: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(headers)) flat[name] = Array.isArray(value) ? value.join(', ') : value
  return flat
}

const readBody = (req: IncomingMessage | Http2ServerRequest, limit: number): Promise<Buffer> =>
  new Promise((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        fail(new HttpError(413, 'Payload Too Large', 'Request body is too large', 'FST_ERR_CTP_BODY_TOO_LARGE'))
        req.removeAllListeners('data')
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => done(Buffer.concat(chunks)))
    req.on('error', fail)
  })

const readFile = (file: string): Promise<Buffer> =>
  new Promise((done, fail) => {
    const chunks: Buffer[] = []
    createReadStream(file)
      .on('data', (chunk) => chunks.push(chunk as Buffer))
      .on('end', () => done(Buffer.concat(chunks)))
      .on('error', fail)
  })

/** The body as the host takes it: JSON parsed, text as text, anything else (an upload) as the bytes. Empty: none. */
function parseBody(body: Buffer, contentType: string | undefined): unknown {
  if (body.length === 0) return undefined
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase()
  if (type === 'application/json' || type.endsWith('+json')) {
    try {
      return JSON.parse(body.toString('utf8'))
    } catch (err) {
      throw new HttpError(400, 'Bad Request', err instanceof Error ? err.message : 'Invalid JSON', 'FST_ERR_CTP_INVALID_JSON_BODY')
    }
  }
  if (type === 'text/plain') return body.toString('utf8')
  return body
}

function hostRequestOf(request: Incoming, path: string): HostRequest {
  const query: Record<string, string> = {}
  const search = request.url.includes('?') ? request.url.slice(request.url.indexOf('?') + 1) : ''
  for (const [name, value] of new URLSearchParams(search)) if (!(name in query)) query[name] = value
  const contentType = request.headers['content-type']
  return {
    method: request.method,
    path,
    query,
    ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
    // The address the TCP connection came from - never taken from the client (it cannot know its own LAN address).
    remoteAddress: request.remoteAddress,
    body: parseBody(request.body, contentType),
    ...(contentType !== undefined ? { contentType } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  }
}

const jsonOut = (status: number, body: unknown, headers: Record<string, string>): Outgoing => ({ kind: 'bytes', status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: Buffer.from(JSON.stringify(body)) })

/** The host's answer as bytes: binary as its type, a string as text, anything else as JSON; no body for none. */
function outgoingOf(answer: HostAnswer, cors: Record<string, string>): Outgoing {
  const headers: Record<string, string> = { ...cors }
  for (const [name, value] of Object.entries(answer.headers ?? {})) headers[name.toLowerCase()] = value
  if (answer.stream) return { kind: 'stream', headers, stream: answer.stream }
  if (answer.binary) return { kind: 'bytes', status: answer.status, headers: { ...headers, 'content-type': answer.binary.contentType }, body: Buffer.from(answer.binary.data) }
  if (answer.body === undefined || answer.status === 204) return { kind: 'bytes', status: answer.status, headers }
  if (typeof answer.body === 'string') return { kind: 'bytes', status: answer.status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body: Buffer.from(answer.body) }
  if (Buffer.isBuffer(answer.body)) return { kind: 'bytes', status: answer.status, headers: { 'content-type': 'application/octet-stream', ...headers }, body: answer.body }
  return { kind: 'bytes', status: answer.status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: Buffer.from(JSON.stringify(answer.body)) }
}

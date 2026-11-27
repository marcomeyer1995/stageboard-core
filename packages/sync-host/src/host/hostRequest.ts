import { guardBandDb, noteBandDbLogin } from './bandDbGuard.js'
import { jobOfRequest, refusalFor } from './capabilities.js'
import { matchChannelStream } from './channels/index.js'
import { createHostRoutes, matchHostRoute, type HostRoute, type HostRoutesDeps } from './routes.js'
import type { PinThrottle } from './pinThrottle.js'
import type { SyncRequest, SyncResponse } from '../index.js'

/** A request as a platform's transport hands it to the host (the native server of the tablet, Fastify on a laptop) (#964). */
export interface HostRequest {
  method: string
  /** The full path as the device sent it, e.g. `/db/stageboard-<id>/_changes` or `/time`. */
  path: string
  query: Readonly<Record<string, string>>
  authorization?: string
  /** The address the connection came from, as the native host saw it. */
  remoteAddress?: string
  /** JSON parsed; an upload as `{ data, contentType }` (the tablet) or as bytes (Node). */
  body?: unknown
  /** The request's `Content-Type`, for a database that takes an attachment as bytes. */
  contentType?: string
  /** Aborted when the device goes away (a long poll on the band database is given up). */
  signal?: AbortSignal
}

/** What a live stream sends: `send` for every message; the returned function stops it. */
export type HostStream = (send: (payload: unknown) => void) => () => void

export interface HostAnswer extends SyncResponse {
  /** Extra response headers (`Retry-After`). */
  headers?: Record<string, string>
  /** A live stream (server-sent events) instead of a body: the transport keeps the connection open and writes each message. */
  stream?: HostStream
}

/** A band database that checks its own logins (the laptop's database host): what it is handed. `path` is without `/db`. */
export interface HostDatabaseRequest {
  method: string
  path: string
  query: Readonly<Record<string, string>>
  body?: unknown
  contentType?: string
  authorization?: string
  signal?: AbortSignal
}

/**
 * One host answers a request (#964): the shared route table and the platform's own routes first, then the host's own `/host/info`, the live streams a platform does not
 * relay (501), the jobs a device cannot do (501), and last the band database behind its band guard (404 not a band of this host, 503 not
 * serving it now, 401 not a device of the band). The same function for every platform; what a platform brings is its deps.
 *
 * (Written for the tablet in #947/#962: what the tablet adds to the routes every host shares (`sync-host`'s `createHostRoutes`, #949): its own
 * address for `/host/info`, the check of a band code, and the band databases with their logins. `serving`
 * (from the shared deps) says per band whether this tablet serves it right now - the shared audio and presence
 * routes are refused with 503 while it is not. A tablet may hold several bands (#962): it serves the bands it
 * founded itself and the band the lease makes it host of, and answers every other band with 404.
 */
export interface HostRequestDeps extends HostRoutesDeps {
  port: number
  /** The tablet's Wi-Fi address, for `/host/info` (the map reads it there). */
  address: string | null
  certFingerprint: string
  state: () => { epoch: number; active: boolean; outdated: boolean; priority: 1 | 2 | null }
  /** A band database request, already past login: sync-host plus the write rules (the tablet). */
  sync?: (ctx: { name: string; roles: string[] }, request: SyncRequest) => Promise<SyncResponse>
  /** The band's device logins (`host-accounts`); null when the login is not one of the band (the tablet). */
  login?: (authorization: string | undefined, db: string) => Promise<{ name: string; roles: string[] } | null>
  /**
   * A database that checks its own logins, at `/db/…` (the laptop's database host): replaces `login` + `sync`, and also answers what under
   * `/db` is not a band database (`/db/`, `_session`).
   */
  database?: (request: HostDatabaseRequest) => Promise<SyncResponse>
  /** The platform's own routes (the Node shell's table, #964 step 2), matched together with the shared ones. */
  ownRoutes?: readonly HostRoute[]
  /** A live stream this platform relays itself (server-sent events on Node): its subscriber, or null when it does not relay `path`. */
  stream?: (path: string) => HostStream | null
  /** The lock after wrong band logins (#396), by username; absent: no lock. */
  loginThrottle?: PinThrottle
}

const json = (status: number, body: unknown): HostAnswer => ({ status, body })
const unauthorized = () => json(401, { error: 'unauthorized', reason: 'Not a device of this band.' })

/** A request path into the band database: `/db/<name>/…` (what a device's PouchDB sends) or `<name>/…`. */
export function bandOfPath(path: string): { db: string; inner: string } | null {
  const stripped = path.replace(/^\/db(?=\/)/, '')
  const parts = stripped.split('/').filter((p) => p !== '')
  if (parts.length === 0) return null
  const db = decodeURIComponent(parts[0]!)
  if (!db.startsWith('stageboard-')) return null
  return { db, inner: '/' + parts.join('/') }
}

/** The native host asks `/_host-login/<db>` before it relays a live channel: which band database that is, or null. */
export function loginCheckOf(path: string): string | null {
  const match = /^\/_host-login\/([^/]+)$/.exec(path)
  const db = match ? decodeURIComponent(match[1]!) : null
  return db !== null && db.startsWith('stageboard-') ? db : null
}

/** The shared table and the platform's own routes, built once per set of deps. */
const tables = new WeakMap<object, HostRoute[]>()
const tableOf = (deps: HostRequestDeps): HostRoute[] => {
  let table = tables.get(deps)
  if (!table) {
    table = [...createHostRoutes({ ...deps, serving: deps.serving ?? (() => deps.state().active) }), ...(deps.ownRoutes ?? [])]
    tables.set(deps, table)
  }
  return table
}

/** An upload arrives from the native host as `{ data, contentType }`; the shared routes take the bytes. */
const bodyOf = (body: unknown): unknown => (body && typeof body === 'object' && (body as { data?: unknown }).data instanceof Uint8Array ? (body as { data: Uint8Array }).data : body)

/**
 * What the app answers on the tablet's own web server (host backup, #947, docs/25 §6g). The routes every
 * host shares come from `sync-host`; what is left here is the tablet's own: `/host/info`, the band database. A passive backup answers the shared routes that need no band (who it is,
 * the lease, the invitation) and refuses the rest with 503 - the clock `/time` is answered natively first.
 */
export async function answerHostRequest(request: HostRequest, deps: HostRequestDeps): Promise<HostAnswer> {
  const method = request.method.toUpperCase()
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path
  const state = deps.state()

  // A HEAD asks what a GET would answer, without the body (the transport sends none).
  const hit = matchHostRoute(tableOf(deps), method === 'HEAD' ? 'GET' : method, path)
  if (hit) {
    const answer = await hit.route.handle({ method, path, params: hit.params, query: request.query, body: bodyOf(request.body), ...(request.authorization ? { authorization: request.authorization } : {}), ...(request.remoteAddress ? { remoteAddress: request.remoteAddress } : {}) })
    return { status: answer.status, body: answer.body ?? null, ...(answer.binary ? { binary: answer.binary } : {}), ...(answer.headers ? { headers: answer.headers } : {}) }
  }

  if ((path === '/host/info' || path === '/server-info') && method === 'GET') {
    return json(200, { lanIp: deps.address, port: deps.port, hostname: 'stageboard.local', certFingerprint: deps.certFingerprint })
  }
  if (method === 'GET') {
    const relayed = deps.stream?.(path) ?? null
    if (relayed) return { status: 200, body: null, stream: relayed }
    // A live stream this host does not relay (the tablet's native host does not carry show state, switches and presence yet): the device
    // lacks the capability - never a plain 404 (#962).
    const stream = matchChannelStream(path)
    if (stream) {
      return json(501, { error: 'capability_missing', capability: `live-stream:${stream.topic}`, reason: `This host does not relay the ${stream.topic} stream yet.` })
    }
  }
  // A job this device cannot do (backup, speech, a plugin that needs Node, ...): 501 and what it lacks - never 404 (#962).
  if (deps.capabilities && jobOfRequest(method, path) !== null) {
    const refused = refusalFor(await deps.capabilities(), method, path)
    if (refused) return json(refused.status, refused.body)
  }
  return answerBandDatabase(request, path, state, deps)
}

/** The band database behind the guard every host has (#964 step 2, `guardBandDb`). */
async function answerBandDatabase(request: HostRequest, path: string, state: ReturnType<HostRequestDeps['state']>, deps: HostRequestDeps): Promise<HostAnswer> {
  const notFound = json(404, { error: 'not_found', reason: 'Not a route of this host.' })
  // A database with its own logins sits at `/db` only; the tablet's native server also hands `stageboard-<id>/…` without it.
  const underDb = path === '/db' || path.startsWith('/db/')
  if (deps.database && !underDb) return notFound
  const band = bandOfPath(path)
  if (!band && !deps.database) return notFound
  const guard = await guardBandDb(band ? band.inner : path, request.authorization, {
    ...(deps.servesBand ? { servesBand: deps.servesBand } : {}),
    serving: deps.serving ?? (() => state.active),
    ...(deps.loginThrottle ? { loginThrottle: deps.loginThrottle } : {}),
  })
  if (guard.kind === 'refused') return { ...guard.answer, ...retryAfter(guard.answer) }

  if (deps.database) {
    // The raw path, trailing slash and all: the database host tells `/db/x/` from `/db/x` itself.
    const out = await deps.database({
      method: request.method,
      path: request.path.slice('/db'.length) || '/',
      query: request.query,
      body: request.body,
      ...(request.contentType !== undefined ? { contentType: request.contentType } : {}),
      ...(request.authorization ? { authorization: request.authorization } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    })
    if (guard.kind === 'band') noteBandDbLogin(deps.loginThrottle, guard.username, out.status)
    return out
  }
  if (guard.kind !== 'band' || !band || !deps.login || !deps.sync) return notFound
  const ctx = await deps.login(request.authorization, band.db)
  noteBandDbLogin(deps.loginThrottle, guard.username, ctx ? 200 : 401)
  if (!ctx) return unauthorized()
  return deps.sync(ctx, {
    method: request.method,
    path: band.inner,
    query: request.query,
    body: request.body,
  })
}

/** A lock's wait as the `Retry-After` header too. */
const retryAfter = (answer: SyncResponse): { headers?: Record<string, string> } => {
  const seconds = (answer.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds
  return typeof seconds === 'number' ? { headers: { 'Retry-After': String(seconds) } } : {}
}

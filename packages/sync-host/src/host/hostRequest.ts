import { jobOfRequest, refusalFor } from './capabilities.js'
import { matchChannelStream } from './channels/index.js'
import { createHostRoutes, matchHostRoute, type HostRoute, type HostRoutesDeps } from './routes.js'
import type { SyncRequest, SyncResponse } from '../index.js'

/** A request as a platform's transport hands it to the host (the native server of the tablet, Fastify on a laptop) (#964). */
export interface HostRequest {
  method: string
  /** The full path as the device sent it, e.g. `/db/stageboard-<id>/_changes` or `/time`. */
  path: string
  query: Readonly<Record<string, string>>
  authorization?: string
  /** The address the connection came from, as the native server saw it. */
  remoteAddress?: string
  /** JSON parsed; an upload as `{ data, contentType }`. */
  body?: unknown
}

export type HostAnswer = SyncResponse

/**
 * One host answers a request (#964): the shared route table first, then the host's own `/server-info`, the live streams a platform does not
 * relay (501), the jobs a device cannot do (501), and last the band database behind its band guard (404 not a band of this host, 503 not
 * serving it now, 401 not a device of the band). The same function for every platform; what a platform brings is its deps.
 *
 * (Written for the tablet in #947/#962: what the tablet adds to the routes every host shares (`sync-host`'s `createHostRoutes`, #949): its own
 * address for `/server-info`, the check of a band code, and the band databases with their logins. `serving`
 * (from the shared deps) says per band whether this tablet serves it right now - the shared audio and presence
 * routes are refused with 503 while it is not. A tablet may hold several bands (#962): it serves the bands it
 * founded itself and the band the lease makes it host of, and answers every other band with 404.
 */
export interface HostRequestDeps extends HostRoutesDeps {
  port: number
  /** The tablet's Wi-Fi address, for `/server-info` (the map reads it there). */
  address: string | null
  certFingerprint: string
  state: () => { epoch: number; active: boolean; outdated: boolean; priority: 1 | 2 | null }
  /** A band database request, already past login: sync-host plus the write rules. */
  sync: (ctx: { name: string; roles: string[] }, request: SyncRequest) => Promise<SyncResponse>
  /** The band's device logins (`host-accounts`); null when the login is not one of the band. */
  login: (authorization: string | undefined, db: string) => Promise<{ name: string; roles: string[] } | null>
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

/** The native server asks `/_host-login/<db>` before it relays a live channel: which band database that is, or null. */
export function loginCheckOf(path: string): string | null {
  const match = /^\/_host-login\/([^/]+)$/.exec(path)
  const db = match ? decodeURIComponent(match[1]!) : null
  return db !== null && db.startsWith('stageboard-') ? db : null
}

/** The shared table, built once per set of deps. */
const tables = new WeakMap<object, HostRoute[]>()
const tableOf = (deps: HostRequestDeps): HostRoute[] => {
  let table = tables.get(deps)
  if (!table) {
    table = createHostRoutes({ ...deps, serving: deps.serving ?? (() => deps.state().active) })
    tables.set(deps, table)
  }
  return table
}

/** An upload arrives from the native server as `{ data, contentType }`; the shared routes take the bytes. */
const bodyOf = (body: unknown): unknown => (body && typeof body === 'object' && (body as { data?: unknown }).data instanceof Uint8Array ? (body as { data: Uint8Array }).data : body)

/**
 * What the app answers on the tablet's own web server (host backup, #947, docs/25 §6g). The routes every
 * host shares come from `sync-host`; what is left here is the tablet's own: `/server-info`, the band database. A passive backup answers the shared routes that need no band (who it is,
 * the lease, the invitation) and refuses the rest with 503 - the clock `/time` is answered natively first.
 */
export async function answerHostRequest(request: HostRequest, deps: HostRequestDeps): Promise<HostAnswer> {
  const method = request.method.toUpperCase()
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path
  const state = deps.state()

  const hit = matchHostRoute(tableOf(deps), method, path)
  if (hit) {
    const answer = await hit.route.handle({ method, path, params: hit.params, query: request.query, body: bodyOf(request.body), ...(request.authorization ? { authorization: request.authorization } : {}), ...(request.remoteAddress ? { remoteAddress: request.remoteAddress } : {}) })
    return { status: answer.status, body: answer.body ?? null, ...(answer.binary ? { binary: answer.binary } : {}) }
  }

  if (path === '/server-info' && method === 'GET') {
    return json(200, { lanIp: deps.address, port: deps.port, hostname: 'stageboard.local', certFingerprint: deps.certFingerprint })
  }
  // A live stream the native server does not relay yet (it carries show state, switches and presence): the device
  // lacks the capability - never a plain 404 (#962).
  const stream = method === 'GET' ? matchChannelStream(path) : null
  if (stream) {
    return json(501, { error: 'capability_missing', capability: `live-stream:${stream.topic}`, reason: `This host does not relay the ${stream.topic} stream yet.` })
  }
  // A job this device cannot do (backup, speech, a plugin that needs Node, ...): 501 and what it lacks - never 404 (#962).
  if (deps.capabilities && jobOfRequest(method, path) !== null) {
    const refused = refusalFor(await deps.capabilities(), method, path)
    if (refused) return json(refused.status, refused.body)
  }
  const band = bandOfPath(path)
  if (!band) return json(404, { error: 'not_found', reason: 'Not a route of this host.' })
  const workspaceId = band.db.slice('stageboard-'.length)
  // A band this tablet does not host is not its business - answering it as a wrong login would still tell a device
  // that the name is a band (the shared routes' reasoning, #958).
  if (deps.servesBand && !(await deps.servesBand(workspaceId))) {
    return json(404, { error: 'not_found', reason: 'Not a band of this host.' })
  }
  // A passive backup holds the band as a device but serves none of it: a device must follow the primary.
  if (!(deps.serving ? deps.serving(workspaceId) : state.active)) {
    return json(503, { error: 'passive', reason: 'This host is not serving the band right now.' })
  }
  const ctx = await deps.login(request.authorization, band.db)
  if (!ctx) return unauthorized()
  return deps.sync(ctx, {
    method: request.method,
    path: band.inner,
    query: request.query,
    body: request.body,
  })
}

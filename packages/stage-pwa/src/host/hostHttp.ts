import { createHostRoutes, matchHostRoute, type HostRoute, type HostRoutesDeps, type SyncRequest, type SyncResponse } from 'sync-host'

/** A request as the native server hands it to the app (LocalHostPlugin.java). */
export interface AppHostRequest {
  method: string
  /** The full path as the device sent it, e.g. `/db/stageboard-<id>/_changes` or `/time`. */
  path: string
  query: Readonly<Record<string, string>>
  authorization?: string
  /** JSON parsed; an upload as `{ data, contentType }`. */
  body?: unknown
}

export type AppHostAnswer = SyncResponse

/**
 * What the tablet adds to the routes every host shares (`sync-host`'s `createHostRoutes`, #949): its own
 * address for `/server-info`, the check of a band code, and the band database with its logins. `serving`
 * (from the shared deps) is whether this tablet is the band's host right now - the shared audio and presence
 * routes are refused with 503 while it is not.
 */
export interface AppHostDeps extends HostRoutesDeps {
  port: number
  /** The tablet's Wi-Fi address, for `/server-info` (the map reads it there). */
  address: string | null
  certFingerprint: string
  state: () => { epoch: number; active: boolean; outdated: boolean; priority: 1 | 2 | null }
  /** Is `code` this band's standing code? A fresh backup checks the invite's code with the primary this way (#945). */
  verifyBandCode: (workspaceId: string, code: string) => Promise<boolean>
  /** A band database request, already past login: sync-host plus the write rules. */
  sync: (ctx: { name: string; roles: string[] }, request: SyncRequest) => Promise<SyncResponse>
  /** The band's device logins (`host-accounts`); null when the login is not one of the band. */
  login: (authorization: string | undefined, db: string) => Promise<{ name: string; roles: string[] } | null>
}

const json = (status: number, body: unknown): AppHostAnswer => ({ status, body })
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
const tableOf = (deps: AppHostDeps): HostRoute[] => {
  let table = tables.get(deps)
  if (!table) {
    table = createHostRoutes({ ...deps, serving: () => deps.state().active })
    tables.set(deps, table)
  }
  return table
}

/** An upload arrives from the native server as `{ data, contentType }`; the shared routes take the bytes. */
const bodyOf = (body: unknown): unknown => (body && typeof body === 'object' && (body as { data?: unknown }).data instanceof Uint8Array ? (body as { data: Uint8Array }).data : body)

/**
 * What the app answers on the tablet's own web server (host backup, #947, docs/25 §6g). The routes every
 * host shares come from `sync-host`; what is left here is the tablet's own: `/server-info`, the band-code
 * check and the band database. A passive backup answers the shared routes that need no band (who it is,
 * the lease, the invitation) and refuses the rest with 503 - the clock `/time` is answered natively first.
 */
export async function answerHostRequest(request: AppHostRequest, deps: AppHostDeps): Promise<AppHostAnswer> {
  const method = request.method.toUpperCase()
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path
  const state = deps.state()

  const hit = matchHostRoute(tableOf(deps), method, path)
  if (hit) {
    const answer = await hit.route.handle({ method, path, params: hit.params, query: request.query, body: bodyOf(request.body) })
    return { status: answer.status, body: answer.body ?? null, ...(answer.binary ? { binary: answer.binary } : {}) }
  }

  if (path === '/server-info' && method === 'GET') {
    return json(200, { lanIp: deps.address, port: deps.port, hostname: 'stageboard.local', certFingerprint: deps.certFingerprint })
  }
  const roster = /^\/workspaces\/([^/]+)\/roster$/.exec(path)
  if (roster && method === 'POST') {
    // Only the host answers for its band: a passive backup confirms no code.
    const code = (request.body as { code?: unknown } | undefined)?.code
    const workspace = decodeURIComponent(roster[1]!)
    const ok = state.active && typeof code === 'string' && (await deps.verifyBandCode(workspace, code))
    return ok ? json(200, { workspaceId: workspace, members: [] }) : json(403, { status: 'error' })
  }

  const band = bandOfPath(path)
  if (!band) return json(404, { error: 'not_found', reason: 'Not a route of this host.' })
  // A passive backup holds the band as a device but serves none of it: a device must follow the primary.
  if (!state.active) return json(503, { error: 'passive', reason: 'This host is the backup and is not serving the band.' })
  const ctx = await deps.login(request.authorization, band.db)
  if (!ctx) return unauthorized()
  return deps.sync(ctx, {
    method: request.method,
    path: band.inner,
    query: request.query,
    body: request.body,
  })
}

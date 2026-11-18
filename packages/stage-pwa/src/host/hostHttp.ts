import type { SyncRequest, SyncResponse } from 'sync-host'
import type { HostRole } from './hostState'
import type { LeaseStatus } from './leaseKeeper'

/** A request as the native server hands it to the app (LocalHostPlugin.java). */
export interface AppHostRequest {
  method: string
  /** The full path as the device sent it, e.g. `/db/stageboard-<id>/_changes` or `/time`. */
  path: string
  query: Readonly<Record<string, string>>
  authorization?: string
  /** JSON parsed; binary attachments as bytes. */
  body?: unknown
}

export type AppHostAnswer = SyncResponse

export interface AppHostDeps {
  hostId: string
  port: number
  /** The tablet's Wi-Fi address, for `/server-info` (the map reads it there). */
  address: string | null
  certFingerprint: string
  /** Band time: own clock plus the primary's offset once there was a sample. */
  bandTime: () => number
  state: () => HostRole & { priority: 1 | 2 | null }
  /** The band this tablet serves while it is the host - null while it is a passive backup. */
  activeWorkspaceId: () => string | null
  lease: () => LeaseStatus | null
  acceptLease: (raw: unknown) => Promise<'accepted' | 'ignored'>
  /** The primary teaching this tablet its band (#945): verified with the primary, never trusted blindly. */
  acceptInvite: (raw: unknown) => Promise<{ ok: true } | { ok: false; status: number; message: string }>
  /** The returned primary asking for a login to copy the tablet's data (#947): only while the tablet is the host. */
  issueAccount: (raw: unknown) => Promise<{ username: string; password: string } | null>
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

/**
 * What the app answers on the tablet's own web server (host backup, #947, docs/25 §6g): while it
 * is a passive backup only the four small routes a host backup needs - who it is, which band it
 * serves (none), the lease, and its own status. Anything that would serve the band (`/db`, the live
 * channels, which the native server relays) is refused until it has taken over. The clock `/time`
 * is answered natively before this, from the state the app pushes.
 */
export async function answerHostRequest(request: AppHostRequest, deps: AppHostDeps): Promise<AppHostAnswer> {
  const method = request.method.toUpperCase()
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path
  const state = deps.state()

  if (path === '/time' && method === 'GET') {
    return json(200, { serverTime: deps.bandTime(), hostId: deps.hostId, epoch: state.epoch, active: state.active })
  }
  if (path === '/server-info' && method === 'GET') {
    return json(200, { lanIp: deps.address, port: deps.port, hostname: 'stageboard.local', certFingerprint: deps.certFingerprint })
  }
  if (path === '/server/active-workspace' && method === 'GET') {
    return json(200, { activeWorkspaceId: deps.activeWorkspaceId() })
  }
  if (path === '/host/lease' && method === 'POST') {
    const accepted = (await deps.acceptLease(request.body)) === 'accepted'
    const now = deps.state()
    return json(200, { accepted, epoch: now.epoch, active: now.active })
  }
  if (path === '/server/host-lease' && method === 'GET') {
    const now = deps.state()
    return json(200, { lease: deps.lease(), clockOffsetMs: null, active: now.active, epoch: now.epoch, outdated: false })
  }
  if (path === '/host/replication-account' && method === 'POST') {
    const account = await deps.issueAccount(request.body)
    return account ? json(200, account) : json(403, {})
  }
  if (path === '/host/join-band-invite' && method === 'POST') {
    const result = await deps.acceptInvite(request.body)
    return result.ok ? json(200, { status: 'ok' }) : json(result.status, { status: 'error', message: result.message })
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

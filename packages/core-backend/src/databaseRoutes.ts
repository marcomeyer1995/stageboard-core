import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseHostRequest } from 'sync-host/database-host'
import type { SyncResponse } from 'sync-host'

/**
 * What devices reach at `/db/...` (#964): the band databases, answered by the host's own database host **in this process** - the same
 * function the host's admin client reaches over HTTP, so no second server and no proxy sits in between. Fastify is only the listener
 * (TLS, HTTP/2) and carries the checks that are Node's: a band's database only for that band's own accounts, and the lock after
 * wrong logins (#396). A platform without a database host here (tests) answers 503.
 */
export interface DatabaseRoutesDeps {
  /** The database host's handler (`BuiltinDatabase.handle`); absent: no database in this process. */
  handle: ((request: DatabaseHostRequest) => Promise<SyncResponse>) | undefined
  /** Why a request must not reach the database, or null if it may (`bandDbProxyRefusal`). */
  refusal: (url: string, authorization: string | undefined) => string | null
  /** Seconds this login is locked for, 0 if not (#396). */
  lockedForSeconds: (authorization: string | undefined) => number
  log: { warn: (meta: Record<string, unknown>, message: string) => void }
}

export function registerDatabaseRoutes(app: FastifyInstance, deps: DatabaseRoutesDeps): void {
  const answer = async (request: FastifyRequest, reply: FastifyReply) => {
    const refusal = deps.refusal(request.url, request.headers.authorization)
    if (refusal) {
      deps.log.warn({ url: request.url.split('?')[0], remoteAddress: request.ip, reason: refusal }, 'Database request for another band refused')
      return reply.status(403).send({ error: 'forbidden', reason: 'Not an account of this band' })
    }
    // The database itself never locks a login - an admin's password is their 4-digit PIN, so guessing it here had no limit (#396 review).
    const lockedFor = deps.lockedForSeconds(request.headers.authorization)
    if (lockedFor > 0) return reply.status(429).header('Retry-After', String(lockedFor)).send({ error: 'locked', reason: 'Too many wrong logins' })
    if (!deps.handle) return reply.status(503).send({ error: 'unavailable', reason: 'No database in this process' })

    const url = new URL(request.url, 'http://localhost')
    // A JSON body arrives parsed; anything else (an attachment) as the bytes with its type - the shape the database host takes.
    const contentType = String(request.headers['content-type'] ?? '')
    const raw = request.body
    const body = raw === undefined || raw === null ? undefined : Buffer.isBuffer(raw) ? (raw.length === 0 ? undefined : contentType.includes('json') || contentType === '' ? safeJson(raw) : { data: new Uint8Array(raw), contentType }) : raw
    // A long poll is given up when the device goes away.
    const abort = new AbortController()
    reply.raw.on('close', () => abort.abort())
    const out = await deps.handle({
      method: request.method,
      path: url.pathname.slice('/db'.length) || '/',
      query: Object.fromEntries(url.searchParams),
      body,
      authorization: request.headers.authorization,
      signal: abort.signal,
    })
    reply.status(out.status)
    if (out.binary) return reply.type(out.binary.contentType).send(Buffer.from(out.binary.data))
    return reply.type('application/json').send(JSON.stringify(out.body))
  }
  for (const url of ['/db', '/db/*']) {
    app.route({ method: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'], url, handler: answer })
  }
}

const safeJson = (raw: Buffer): unknown => {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    return undefined
  }
}

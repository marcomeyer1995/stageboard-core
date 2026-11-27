import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseHostRequest } from 'sync-host/database-host'
import { guardBandDb, noteBandDbLogin, type BandDbGuardDeps, type SyncResponse } from 'sync-host'

/**
 * What devices reach at `/db/...` (#964): the band databases, answered by the host's own database host **in this process** - the same
 * function the host's admin client reaches over HTTP, so no second server and no proxy sits in between. Fastify is only the listener
 * (TLS, HTTP/2). In front of it sits the guard every host has (`guardBandDb`, #964 step 2): a band's database only for that band's own
 * accounts, the lock after wrong logins (#396), 404/503 for a band this host does not host or serve. A platform without a database host
 * here (tests) answers 503.
 */
export interface DatabaseRoutesDeps {
  /** The database host's handler (`BuiltinDatabase.handle`); absent: no database in this process. */
  handle: ((request: DatabaseHostRequest) => Promise<SyncResponse>) | undefined
  /** Which bands this host hosts and serves, and the lock after wrong logins (#396). */
  guard: BandDbGuardDeps
  log: { warn: (meta: Record<string, unknown>, message: string) => void }
}

export function registerDatabaseRoutes(app: FastifyInstance, deps: DatabaseRoutesDeps): void {
  const answer = async (request: FastifyRequest, reply: FastifyReply) => {
    const guard = await guardBandDb(request.url, request.headers.authorization, deps.guard)
    if (guard.kind === 'refused') {
      deps.log.warn({ url: request.url.split('?')[0], remoteAddress: request.ip, status: guard.answer.status, reason: guard.reason }, 'Database request refused')
      const retryAfter = (guard.answer.body as { retryAfterSeconds?: number }).retryAfterSeconds
      if (retryAfter !== undefined) reply.header('Retry-After', String(retryAfter))
      return reply.status(guard.answer.status).send(guard.answer.body)
    }
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
    // The database itself never locks a login - an admin's password is their 4-digit PIN, so guessing it here had no limit (#396 review).
    if (guard.kind === 'band' && noteBandDbLogin(deps.guard.loginThrottle, guard.username, out.status)) {
      deps.log.warn({ username: guard.username, remoteAddress: request.ip }, 'Too many wrong database logins - locked out temporarily')
    }
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

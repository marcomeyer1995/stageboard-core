import { createSyncHost, type SyncDatabase, type SyncRequest, type SyncResponse } from './index.js'

/**
 * A small CouchDB for StageBoard's own needs (docs/25, Host step 1, 2026-11-07): what core-backend's
 * `couch.ts` and the devices ask of a CouchDB, over PouchDB databases - so a laptop (and later an
 * Android tablet) can be the host without Docker. On top of the replication protocol (index.ts):
 * the server admin, user accounts with hashed passwords, the login check (`_session`), each band's
 * access rules (`_security`), the validation functions stored in a band (`_design/…`), and making,
 * listing and deleting databases. Plain WebCrypto, no Node API.
 */

export interface CouchHostOptions {
  /** Opens (creating if `create`) the stored database of this name - the host keeps the list. */
  storage: (name: string) => SyncDatabase
  /** The names of the databases that exist, and their bookkeeping. */
  catalog: Catalog
  /** The server admin - core-backend's own account (COUCHDB_USER / COUCHDB_PASSWORD). */
  admin: { user: string; password: string }
  longpollMaxMs?: number
}

/** Which databases exist - kept apart from the databases themselves so a host can persist it (a
 * file on the laptop, app storage on Android). */
export interface Catalog {
  list: () => Promise<string[]>
  add: (name: string) => Promise<void>
  remove: (name: string) => Promise<void>
}

export interface UserCtx {
  name: string | null
  roles: string[]
}

interface SecurityDoc {
  admins?: { names?: string[]; roles?: string[] }
  members?: { names?: string[]; roles?: string[] }
}

const USERS = '_users'
const SECURITY_ID = '_local/_security'
const ITERATIONS = 10_000

const json = (status: number, body: unknown): SyncResponse => ({ status, body })
const error = (status: number, name: string, reason: string): SyncResponse => json(status, { error: name, reason })

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' }, key, 256)
  return hex(bits)
}

/** Constant-time string comparison - a password check must not tell how much matched. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** A user document as stored: never the password, only its derived key (CouchDB does the same). */
async function hashUser(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof doc.password !== 'string') return doc
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const derived_key = await pbkdf2(doc.password, salt, ITERATIONS)
  const { password: _plain, ...rest } = doc
  void _plain
  return { ...rest, password_scheme: 'pbkdf2', pbkdf2_prf: 'sha256', iterations: ITERATIONS, salt, derived_key }
}

function basicAuth(header: string | undefined): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null
  try {
    const decoded = atob(header.slice(6))
    const at = decoded.indexOf(':')
    return at < 0 ? null : { user: decoded.slice(0, at), password: decoded.slice(at + 1) }
  } catch {
    return null
  }
}

const isServerAdmin = (ctx: UserCtx) => ctx.roles.includes('_admin')

function inList(ctx: UserCtx, list: { names?: string[]; roles?: string[] } | undefined): boolean {
  if (!list) return false
  return (ctx.name !== null && (list.names ?? []).includes(ctx.name)) || (list.roles ?? []).some((r) => ctx.roles.includes(r))
}

/** A validate_doc_update function from a design document - written only by the server (admins). */
type Validator = (newDoc: unknown, oldDoc: unknown, userCtx: UserCtx, secObj: SecurityDoc) => void
const compiled = new Map<string, Validator>()
function compile(source: string): Validator {
  let fn = compiled.get(source)
  if (!fn) {
    fn = new Function(`return (${source})`)() as Validator
    compiled.set(source, fn)
  }
  return fn
}

export interface CouchHostRequest extends SyncRequest {
  /** The `Authorization` header as received. */
  authorization?: string
}

export function createCouchHost(options: CouchHostOptions) {
  const opened = new Map<string, SyncDatabase>()
  const db = (name: string) => {
    let d = opened.get(name)
    if (!d) {
      d = options.storage(name)
      opened.set(name, d)
    }
    return d
  }
  const exists = async (name: string) => name === USERS || (await options.catalog.list()).includes(name)

  /** Who is asking: the server admin, a user whose password checks out, or nobody. */
  const whoIs = async (authorization: string | undefined): Promise<UserCtx | null> => {
    const creds = basicAuth(authorization)
    if (!creds) return { name: null, roles: [] }
    if (creds.user === options.admin.user) return same(creds.password, options.admin.password) ? { name: creds.user, roles: ['_admin'] } : null
    const doc = (await db(USERS)
      .get(`org.couchdb.user:${creds.user}`)
      .catch(() => null)) as { derived_key?: string; salt?: string; iterations?: number; roles?: string[] } | null
    if (!doc?.derived_key || !doc.salt) return null
    const derived = await pbkdf2(creds.password, doc.salt, doc.iterations ?? ITERATIONS)
    return same(derived, doc.derived_key) ? { name: creds.user, roles: doc.roles ?? [] } : null
  }

  const security = async (name: string): Promise<SecurityDoc> => ((await db(name).get(SECURITY_ID).catch(() => null)) as SecurityDoc | null) ?? {}

  /** CouchDB 3: a database without members is for admins only. */
  const access = async (name: string, ctx: UserCtx): Promise<'admin' | 'member' | null> => {
    if (isServerAdmin(ctx)) return 'admin'
    if (name === USERS) return null
    const sec = await security(name)
    if (inList(ctx, sec.admins)) return 'admin'
    if (inList(ctx, sec.members)) return 'member'
    return null
  }

  /** The band's validators against each incoming document; a refused one comes back as an error row. */
  const validate = async (name: string, ctx: UserCtx, docs: Record<string, unknown>[]): Promise<{ ok: Record<string, unknown>[]; refused: { id: string; error: string; reason: string }[] }> => {
    if (isServerAdmin(ctx)) return { ok: docs, refused: [] }
    const store = db(name)
    const designs = await store.allDocs({ startkey: '_design/', endkey: '_design/￿', include_docs: true })
    const validators = designs.rows.flatMap((r) => {
      const source = (r.doc as { validate_doc_update?: string } | undefined)?.validate_doc_update
      return source ? [compile(source)] : []
    })
    const sec = await security(name)
    const dbAdmin = inList(ctx, sec.admins)
    const ok: Record<string, unknown>[] = []
    const refused: { id: string; error: string; reason: string }[] = []
    for (const doc of docs) {
      const id = String(doc._id)
      if (id.startsWith('_design/') && !dbAdmin) {
        refused.push({ id, error: 'unauthorized', reason: 'Only admins may write design documents.' })
        continue
      }
      const oldDoc = await store.get(id).catch(() => null)
      try {
        for (const v of validators) v(doc, oldDoc, ctx, sec)
        ok.push(doc)
      } catch (thrown) {
        const t = thrown as { forbidden?: string; unauthorized?: string }
        refused.push({ id, error: t.unauthorized ? 'unauthorized' : 'forbidden', reason: t.forbidden ?? t.unauthorized ?? String(thrown) })
      }
    }
    return { ok, refused }
  }

  const sync = createSyncHost({ open: (name) => db(name), longpollMaxMs: options.longpollMaxMs })

  return async (request: CouchHostRequest): Promise<SyncResponse> => {
    const method = request.method.toUpperCase()
    const ctx = await whoIs(request.authorization)
    if (!ctx) return error(401, 'unauthorized', 'Name or password is incorrect.')
    const parts = request.path.split('/').filter((p) => p !== '')
    const [first, second] = parts

    if (first === undefined) return sync(request)
    if (first === '_session') return json(200, { ok: true, userCtx: ctx, info: { authenticated: ctx.name ? 'default' : undefined } })
    if (first === '_all_dbs') {
      if (!isServerAdmin(ctx)) return error(403, 'forbidden', 'Server admin only.')
      return json(200, (await options.catalog.list()).sort())
    }
    if (first === '_up') return json(200, { status: 'ok' })

    const name = decodeURIComponent(first)
    // The database itself: create, delete.
    if (second === undefined && (method === 'PUT' || method === 'DELETE')) {
      if (!isServerAdmin(ctx)) return error(403, 'forbidden', 'Server admin only.')
      if (method === 'PUT') {
        if (await exists(name)) return error(412, 'file_exists', 'The database could not be created, the file already exists.')
        await options.catalog.add(name)
        db(name)
        return json(201, { ok: true })
      }
      if (!(await exists(name))) return error(404, 'not_found', 'Database does not exist.')
      await db(name).destroy()
      opened.delete(name)
      await options.catalog.remove(name)
      return json(200, { ok: true })
    }
    if (!(await exists(name))) return error(404, 'not_found', 'Database does not exist.')

    // Accounts: only the server admin reads and writes them; passwords are stored hashed.
    if (name === USERS) {
      if (!isServerAdmin(ctx)) return error(403, 'forbidden', 'Server admin only.')
      if (method === 'PUT' && second?.startsWith('org.couchdb.user:')) {
        const doc = await hashUser({ ...(request.body as Record<string, unknown>), _id: decodeURIComponent(second) })
        const existing = await db(USERS).get(String(doc._id)).catch(() => null)
        if (existing && doc._rev === undefined) return error(409, 'conflict', 'Document update conflict.')
        return json(201, await db(USERS).put(doc as PouchDB.Core.PutDocument<object>))
      }
      return sync(request)
    }

    const role = await access(name, ctx)
    if (!role) return ctx.name === null ? error(401, 'unauthorized', 'You are not authorized to access this db.') : error(403, 'forbidden', 'You are not allowed to access this db.')

    // The access rules live in a local document - never writable as one.
    if (second === '_local' && decodeURIComponent(parts[2] ?? '') === '_security') return error(403, 'forbidden', 'Use _security.')

    if (second === '_security') {
      if (method === 'GET') return json(200, await security(name))
      if (method === 'PUT') {
        if (role !== 'admin') return error(403, 'forbidden', 'Admins only.')
        const store = db(name)
        const current = await store.get(SECURITY_ID).catch(() => null)
        await store.put({ ...(request.body as object), _id: SECURITY_ID, ...(current ? { _rev: current._rev } : {}) })
        return json(200, { ok: true })
      }
    }

    // Writes go through the band's validators - also what arrives by replication.
    if (method === 'POST' && second === '_bulk_docs') {
      const body = request.body as { docs: Record<string, unknown>[]; new_edits?: boolean }
      const { ok, refused } = await validate(name, ctx, body.docs)
      const written = ok.length > 0 ? ((await sync({ ...request, body: { ...body, docs: ok } })).body as unknown[]) : []
      return json(201, [...written, ...refused])
    }
    if ((method === 'PUT' || method === 'DELETE') && second !== undefined && !second.startsWith('_local') && parts.length === 2) {
      const id = decodeURIComponent(second)
      const doc = method === 'DELETE' ? { _id: id, _rev: request.query.rev, _deleted: true } : { ...(request.body as object), _id: id }
      const { refused } = await validate(name, ctx, [doc])
      if (refused[0]) return error(refused[0].error === 'unauthorized' ? 401 : 403, refused[0].error, refused[0].reason)
    }
    return sync(request)
  }
}

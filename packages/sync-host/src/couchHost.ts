import { createSyncHost, type SyncDatabase, type SyncRequest, type SyncResponse } from './index.js'
export type { UserCtx } from './writeGuard.js'
import { basicCredentials, hex, pbkdf2, same } from './passwords.js'
import { createBandAccountStore } from './host/bandAccountStore.js'
import { createBandAccounts, type BandAccounts } from './host/bandAccounts.js'
import { createWriteGuard, inList, isServerAdmin, type SecurityDoc, type UserCtx } from './writeGuard.js'

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


const USERS = '_users'
const SECURITY_ID = '_local/_security'
const ITERATIONS = 10_000

const json = (status: number, body: unknown): SyncResponse => ({ status, body })
const error = (status: number, name: string, reason: string): SyncResponse => json(status, { error: name, reason })

async function hashUser(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof doc.password !== 'string') return doc
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const derived_key = await pbkdf2(doc.password, salt, ITERATIONS)
  const { password: _plain, ...rest } = doc
  void _plain
  return { ...rest, password_scheme: 'pbkdf2', pbkdf2_prf: 'sha256', iterations: ITERATIONS, salt, derived_key }
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

  // A checked login is remembered for a while, like CouchDB does: an account copied from CouchDB has
  // 600,000 PBKDF2 rounds - every sync request would otherwise wait for them. Forgotten when any
  // account changes.
  const verified = new Map<string, { ctx: UserCtx; until: number }>()
  const VERIFIED_MS = 5 * 60_000

  // The accounts of each band, kept in the band's own database (#960). One instance per band: it keeps its own
  // remembered logins, so a login of one band is never taken for another's.
  const bandAccounts = new Map<string, BandAccounts>()
  const accountsOf = (dbName: string): BandAccounts => {
    let accounts = bandAccounts.get(dbName)
    if (!accounts) {
      accounts = createBandAccounts({ store: createBandAccountStore(db(dbName) as never), workspaceId: dbName.slice('stageboard-'.length) })
      bandAccounts.set(dbName, accounts)
    }
    return accounts
  }

  /** Who is asking: the server admin, a user whose password checks out, a device login of the band whose database
   * this is, or nobody. */
  const whoIs = async (authorization: string | undefined, dbName?: string): Promise<UserCtx | null> => {
    const known = authorization ? verified.get(authorization) : undefined
    if (known && known.until > Date.now()) return known.ctx
    const ctx = await checkLogin(authorization)
    if (ctx && ctx.name !== null && authorization) verified.set(authorization, { ctx, until: Date.now() + VERIFIED_MS })
    if (ctx || !dbName?.startsWith('stageboard-') || !(await exists(dbName))) return ctx
    return accountsOf(dbName).login(authorization)
  }

  const checkLogin = async (authorization: string | undefined): Promise<UserCtx | null> => {
    const creds = basicCredentials(authorization)
    if (!creds) return { name: null, roles: [] }
    if (creds.user === options.admin.user) return same(creds.password, options.admin.password) ? { name: creds.user, roles: ['_admin'] } : null
    const doc = (await db(USERS)
      .get(`org.couchdb.user:${creds.user}`)
      .catch(() => null)) as { derived_key?: string; salt?: string; iterations?: number; pbkdf2_prf?: string; roles?: string[] } | null
    if (!doc?.derived_key || !doc.salt) return null
    const derived = await pbkdf2(creds.password, doc.salt, doc.iterations ?? ITERATIONS, doc.pbkdf2_prf)
    return same(derived, doc.derived_key) ? { name: creds.user, roles: doc.roles ?? [] } : null
  }

  /** The band's access rules as CouchDB gives them: `admins` and `members` only - the document they are kept in
   * (its id and revision) is this host's own business and must not leak, or a backup could not put them back. */
  const security = async (name: string): Promise<SecurityDoc> => {
    const stored = (await db(name).get(SECURITY_ID).catch(() => null)) as (SecurityDoc & { _id?: string; _rev?: string }) | null
    if (!stored) return {}
    const { _id, _rev, ...rules } = stored
    void _id
    void _rev
    return rules
  }

  /** CouchDB 3: a database without members is for admins only. */
  const access = async (name: string, ctx: UserCtx): Promise<'admin' | 'member' | null> => {
    if (isServerAdmin(ctx)) return 'admin'
    if (name === USERS) return null
    const sec = await security(name)
    if (inList(ctx, sec.admins)) return 'admin'
    if (inList(ctx, sec.members)) return 'member'
    return null
  }

  const guard = createWriteGuard({ open: (name) => db(name), security })
  const sync = createSyncHost({ open: (name) => db(name), longpollMaxMs: options.longpollMaxMs })

  const handle = async (request: CouchHostRequest): Promise<SyncResponse> => {
    const method = request.method.toUpperCase()
    const parts = request.path.split('/').filter((p) => p !== '')
    const [first, second] = parts
    const ctx = await whoIs(request.authorization, first === undefined ? undefined : decodeURIComponent(first))
    if (!ctx) return error(401, 'unauthorized', 'Name or password is incorrect.')

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
      if (method !== 'GET' && method !== 'HEAD') verified.clear()
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
        // Whatever id or revision the body carries (a backup reads them back from an older host) is not the stored document's.
        const { _id, _rev, ...rules } = request.body as Record<string, unknown>
        void _id
        void _rev
        await store.put({ ...rules, _id: SECURITY_ID, ...(current ? { _rev: current._rev } : {}) })
        return json(200, { ok: true })
      }
    }

    // Writes go through the band's validators - also what arrives by replication.
    return guard(ctx, request, sync)
  }

  /** Closes every open database - before the host stops, so its files are released. */
  const close = async () => {
    await Promise.all([...opened.values()].map((d) => d.close().catch(() => undefined)))
    opened.clear()
  }
  return Object.assign(handle, { close })
}

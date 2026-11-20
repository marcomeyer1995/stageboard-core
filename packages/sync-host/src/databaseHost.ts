import { createSyncHost, type SyncDatabase, type SyncRequest, type SyncResponse } from './index.js'
export type { UserCtx } from './writeGuard.js'
import { basicCredentials, same } from './passwords.js'
import { createBandAccountStore } from './host/bandAccountStore.js'
import { createBandAccounts, type BandAccounts } from './host/bandAccounts.js'
import { BAND_SETTINGS_DOC_ID, listedHostIds } from './host/hostRole.js'
import { createWriteGuard, inList, isServerAdmin, type SecurityDoc, type UserCtx } from './writeGuard.js'

/**
 * The database host of a Host (docs/25, #960): what core-backend's database client and the devices ask of a
 * database, over PouchDB databases - so a laptop, a Linux box and an Android tablet can all be the host with the same
 * code. On top of the replication protocol (index.ts): the server admin, the login of a device (an `account:` document of
 * the band's own database, `createBandAccounts`), each band's access rules (`_security`), the validation functions stored
 * in a band (`_design/…`), and making, listing and deleting databases. Plain WebCrypto, no Node API.
 */

export interface DatabaseHostOptions {
  /** Opens (creating if `create`) the stored database of this name - the host keeps the list. */
  storage: (name: string) => SyncDatabase
  /** The names of the databases that exist, and their bookkeeping. */
  catalog: Catalog
  /** The server admin - core-backend's own login (STAGEBOARD_DB_USER / STAGEBOARD_DB_PASSWORD). */
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


const SECURITY_ID = '_local/_security'

const json = (status: number, body: unknown): SyncResponse => ({ status, body })
const error = (status: number, name: string, reason: string): SyncResponse => json(status, { error: name, reason })

export interface DatabaseHostRequest extends SyncRequest {
  /** The `Authorization` header as received. */
  authorization?: string
}

export function createDatabaseHost(options: DatabaseHostOptions) {
  const opened = new Map<string, SyncDatabase>()
  const db = (name: string) => {
    let d = opened.get(name)
    if (!d) {
      d = options.storage(name)
      opened.set(name, d)
    }
    return d
  }
  const exists = async (name: string) => (await options.catalog.list()).includes(name)

  // The server admin's login is checked in constant time and needs no remembering; a device's login is remembered by
  // its band's accounts (below) - PBKDF2 is slow, and every sync request would otherwise wait for it.

  // The accounts of each band, kept in the band's own database (#960). One instance per band: it keeps its own
  // remembered logins, so a login of one band is never taken for another's.
  const bandAccounts = new Map<string, BandAccounts>()
  const accountsOf = (dbName: string): BandAccounts => {
    let accounts = bandAccounts.get(dbName)
    if (!accounts) {
      accounts = createBandAccounts({
        store: createBandAccountStore(db(dbName) as never),
        workspaceId: dbName.slice('stageboard-'.length),
        // The devices the band lists as hosts have the role `host` (#960): they write the band's accounts with their own sync.
        hostDevices: async () => listedHostIds(await db(dbName).get(BAND_SETTINGS_DOC_ID).catch(() => null)),
      })
      bandAccounts.set(dbName, accounts)
    }
    return accounts
  }

  /** Who is asking: the server admin, a device login of the band whose database this is, anybody without a login (an
   * anonymous request - it gets into nothing), or nobody (a login that does not check out). */
  const whoIs = async (authorization: string | undefined, dbName?: string): Promise<UserCtx | null> => {
    const creds = basicCredentials(authorization)
    if (!creds) return { name: null, roles: [] }
    if (creds.user === options.admin.user) return same(creds.password, options.admin.password) ? { name: creds.user, roles: ['_admin'] } : null
    if (!dbName?.startsWith('stageboard-') || !(await exists(dbName))) return null
    return accountsOf(dbName).login(authorization)
  }

  /** The band's access rules as the database gives them: `admins` and `members` only - the document they are kept in
   * (its id and revision) is this host's own business and must not leak, or a backup could not put them back. */
  const security = async (name: string): Promise<SecurityDoc> => {
    const stored = (await db(name).get(SECURITY_ID).catch(() => null)) as (SecurityDoc & { _id?: string; _rev?: string }) | null
    if (!stored) return {}
    const { _id, _rev, ...rules } = stored
    void _id
    void _rev
    return rules
  }

  /** the database 3: a database without members is for admins only. */
  const access = async (name: string, ctx: UserCtx): Promise<'admin' | 'member' | null> => {
    if (isServerAdmin(ctx)) return 'admin'
    const sec = await security(name)
    if (inList(ctx, sec.admins)) return 'admin'
    if (inList(ctx, sec.members)) return 'member'
    return null
  }

  const guard = createWriteGuard({ open: (name) => db(name), security })
  const sync = createSyncHost({ open: (name) => db(name), longpollMaxMs: options.longpollMaxMs })

  const handle = async (request: DatabaseHostRequest): Promise<SyncResponse> => {
    const method = request.method.toUpperCase()
    const parts = request.path.split('/').filter((p) => p !== '')
    const [first, second] = parts
    const ctx = await whoIs(request.authorization, first === undefined ? undefined : decodeURIComponent(first))
    if (!ctx) return error(401, 'unauthorized', 'Name or password is incorrect.')

    if (first === undefined) return sync(request)
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

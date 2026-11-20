import { createBandAccountStore, createBandAccounts, ROSTER_VALIDATOR_SOURCE, type BandAccounts, type BandStore } from 'sync-host'

/**
 * The tablet's bands (#962): the same life cycle every host answers, over the PouchDB databases the app already
 * holds. The rules are `sync-host`'s `createBandCatalog`; this only says how a band is made, read, changed and
 * removed in IndexedDB. A band the tablet founded records its `hostId` in the access doc, so it can serve that band
 * later even while another one is the active band.
 */

/** The slice of a PouchDB database the store uses (the app's `getWorkspaceDb` hands over more). */
export interface BandDatabase {
  get(id: string): Promise<Record<string, unknown>>
  put(doc: Record<string, unknown>): Promise<unknown>
  allDocs(options: { startkey: string; endkey: string; include_docs: true; attachments?: boolean }): Promise<{ rows: { doc?: unknown }[] }>
}

export interface TabletBandStoreDeps {
  /** The id of this tablet as a host - written into every band it founds. */
  hostId: string
  /** Every band id the app holds locally. */
  bandIds: () => Promise<string[]>
  open: (workspaceId: string) => BandDatabase
  /** Keeps a copy of a band's documents under another name before it is destroyed (#362). */
  copy: (workspaceId: string, docs: Record<string, unknown>[]) => Promise<void>
  /** Bands deleted on this device - never founded again (#364). */
  deleted: { is: (workspaceId: string) => boolean; mark: (workspaceId: string) => void }
  now?: () => number
}

/** `stageboard-<id>`, the same name the app's `localDbName` derives (one definition of the rule, one of the name). */
export const bandDbName = (workspaceId: string): string => `stageboard-${workspaceId}`

const ACCESS_DOC_ID = 'workspace:access'
const DEVICE_PREFIX = 'devices:'
const PROFILE_PREFIX = 'profiles:'

interface AccessDoc extends Record<string, unknown> {
  _id: string
  _rev?: string
  code: string
  name: string
  hostId?: string
  masterMode?: 'device' | 'account'
}

/** A Basic header from a name and password, as UTF-8 like the laptop's - `btoa` alone throws on a character beyond Latin-1, and a
 * wrong login must be answered as one, not crash into a 500. */
function basicHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** 8 digits, zero-padded - the "WiFi password" a band writes down once (the laptop's rule, in the browser). */
function generateAccessCode(): string {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return (value[0]! % 100_000_000).toString().padStart(8, '0')
}

export function createTabletBandStore(deps: TabletBandStoreDeps): BandStore {
  // Accounts are bound to the database handle they were built on; when the host opens a band's handle again (the browser closed
  // the connection), the accounts follow it.
  const accountsPerBand = new Map<string, { handle: unknown; accounts: BandAccounts }>()
  const accountsFor = (workspaceId: string): BandAccounts => {
    const handle = deps.open(workspaceId)
    let known = accountsPerBand.get(workspaceId)
    if (!known || known.handle !== handle) {
      known = { handle, accounts: createBandAccounts({ store: createBandAccountStore(handle as never), workspaceId }) }
      accountsPerBand.set(workspaceId, known)
    }
    return known.accounts
  }
  const read = (workspaceId: string, id: string) => deps.open(workspaceId).get(id).catch((err: { status?: number }) => {
    if (err.status === 404) return null
    throw err
  })
  const write = async (workspaceId: string, id: string, change: (existing: Record<string, unknown> | null) => Record<string, unknown>) => {
    const existing = await read(workspaceId, id)
    await deps.open(workspaceId).put(change(existing))
  }
  const accessDoc = (existing: Record<string, unknown> | null, code: string, name: string, masterMode?: 'device' | 'account'): AccessDoc => ({
    ...(existing ?? {}),
    _id: ACCESS_DOC_ID,
    ...(typeof existing?._rev === 'string' ? { _rev: existing._rev } : {}),
    code,
    name,
    ...(masterMode ? { masterMode } : {}),
    ...(typeof existing?.hostId === 'string' ? { hostId: existing.hostId } : {}),
  })

  const ensureAccess = async (workspaceId: string, fallbackName: string): Promise<AccessDoc> => {
    const existing = (await read(workspaceId, ACCESS_DOC_ID)) as AccessDoc | null
    if (existing) return existing
    const doc = accessDoc(null, generateAccessCode(), fallbackName)
    await deps.open(workspaceId).put(doc)
    return doc
  }

  return {
    bands: () => deps.bandIds(),
    isDeleted: (workspaceId) => deps.deleted.is(workspaceId),
    markDeleted: (workspaceId) => deps.deleted.mark(workspaceId),

    async create(workspaceId, name, founder) {
      const db = deps.open(workspaceId)
      await db.put({ ...accessDoc(null, generateAccessCode(), name), hostId: deps.hostId })
      // The same write rules the laptop puts into a band database: a band founded here can move to a laptop unchanged.
      await db.put({ _id: '_design/roster', validate_doc_update: ROSTER_VALIDATOR_SOURCE })
      return accountsFor(workspaceId).provisionDevice(founder.founderId, founder.deviceId, true)
    },

    async remove(workspaceId) {
      // The app's database can be destroyed by the platform's own cleanup; a copy first, like the laptop (#362).
      const rows = await deps.open(workspaceId).allDocs({ startkey: '', endkey: '\ufff0', include_docs: true, attachments: true })
      const docs = rows.rows.flatMap((row) => (row.doc ? [row.doc as Record<string, unknown>] : []))
      await deps.copy(workspaceId, docs)
      await (deps.open(workspaceId) as BandDatabase & { destroy?: () => Promise<void> }).destroy?.()
    },

    accessCode: async (workspaceId) => {
      const doc = (await read(workspaceId, ACCESS_DOC_ID)) as AccessDoc | null
      return doc ? { code: doc.code, name: doc.name } : null
    },
    ensureAccessCode: async (workspaceId, fallbackName) => {
      const doc = await ensureAccess(workspaceId, fallbackName)
      return { code: doc.code, name: doc.name }
    },
    async rotateAccessCode(workspaceId) {
      const code = generateAccessCode()
      await write(workspaceId, ACCESS_DOC_ID, (existing) => accessDoc(existing, code, (existing as AccessDoc | null)?.name ?? workspaceId, (existing as AccessDoc | null)?.masterMode))
      return code
    },
    async rename(workspaceId, name) {
      await write(workspaceId, ACCESS_DOC_ID, (existing) => accessDoc(existing, (existing as AccessDoc | null)?.code ?? generateAccessCode(), name, (existing as AccessDoc | null)?.masterMode))
    },
    async setMasterMode(workspaceId, masterMode) {
      await write(workspaceId, ACCESS_DOC_ID, (existing) => accessDoc(existing, (existing as AccessDoc | null)?.code ?? generateAccessCode(), (existing as AccessDoc | null)?.name ?? workspaceId, masterMode))
    },
    login: (workspaceId, username, password) => accountsFor(workspaceId).login(basicHeader(username, password)),
    checkAdmin: async (workspaceId, username, password) => {
      const login = await accountsFor(workspaceId).login(basicHeader(username, password))
      return login?.roles.includes('admin') ?? false
    },
    async isAdminOfAnyBand(username, password) {
      for (const workspaceId of await deps.bandIds()) {
        const login = await accountsFor(workspaceId).login(basicHeader(username, password))
        if (login?.roles.includes('admin')) return true
      }
      return false
    },
    async setDeviceRevoked(workspaceId, deviceId, revoked) {
      const id = `${DEVICE_PREFIX}${deviceId}`
      const existing = await read(workspaceId, id)
      if (!existing) return 'unknown'
      await write(workspaceId, id, () => ({ ...existing, revoked }))
      return 'ok'
    },
    async forgetDevice(workspaceId, deviceId) {
      const id = `${DEVICE_PREFIX}${deviceId}`
      const existing = (await read(workspaceId, id)) as { revoked?: boolean } | null
      if (!existing) return 'unknown'
      if (existing.revoked) return 'blocked'
      const rows = await deps.open(workspaceId).allDocs({ startkey: 'logical-devices:', endkey: 'logical-devices:\ufff0', include_docs: true })
      const usedBy = rows.rows
        .flatMap((row) => (row.doc ? [row.doc as { executionTarget?: string | null; name?: string; _id?: string }] : []))
        .filter((doc) => doc.executionTarget === deviceId)
        .map((doc) => doc.name ?? doc._id ?? '')
      if (usedBy.length > 0) return { usedBy }
      await write(workspaceId, id, () => ({ _id: id, _rev: (existing as { _rev?: string })._rev, _deleted: true }))
      return 'ok'
    },
  }
}

/** The profiles of a band as the roster reads them - the tablet's own side of `band.profileDocs`. */
export async function profileDocsOf(db: BandDatabase): Promise<Record<string, unknown>[]> {
  const rows = await db.allDocs({ startkey: PROFILE_PREFIX, endkey: `${PROFILE_PREFIX}\ufff0`, include_docs: true })
  return rows.rows.flatMap((row) => (row.doc ? [row.doc as Record<string, unknown>] : []))
}

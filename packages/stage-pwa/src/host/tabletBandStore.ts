import { createBandAccountStore, createBandAccounts, createBandDocuments, type BandAccounts, type BandDocument, type BandDocumentPort, type BandStore } from 'sync-host'

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

const PROFILE_PREFIX = 'profiles:'

/** A Basic header from a name and password, as UTF-8 like the laptop's - `btoa` alone throws on a character beyond Latin-1, and a
 * wrong login must be answered as one, not crash into a 500. */
function basicHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

/** A band's documents in the app's PouchDB, as sync-host's band rules read and write them: a write that lost against another
 * (409) is made again on the stored revision. */
export function pouchBandPort(db: BandDatabase): BandDocumentPort {
  const get = (id: string) =>
    db.get(id).then(
      (doc) => doc as BandDocument,
      (err: { status?: number }) => {
        if (err.status === 404) return null
        throw err
      },
    )
  return {
    get,
    async update(id, change) {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const next = change(await get(id))
        if (!next) return
        try {
          await db.put(next)
          return
        } catch (err) {
          const status = (err as { status?: number }).status
          if (status === 404 && next._deleted) return
          if (status !== 409 || attempt === 5) throw err
        }
      }
    },
    list: async (prefix) => (await db.allDocs({ startkey: prefix, endkey: `${prefix}\ufff0`, include_docs: true })).rows.flatMap((row) => (row.doc ? [row.doc as BandDocument] : [])),
  }
}

/** The band life cycle, plus bringing a band's write rules up to this version (`updateRules`, sync-host's). */
export type TabletBandStore = BandStore & { updateRules: (workspaceId: string) => Promise<boolean> }

export function createTabletBandStore(deps: TabletBandStoreDeps): TabletBandStore {
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
  // The access doc and the Device Ledger: sync-host's rules, the same as the laptop's (#964).
  const documents = createBandDocuments({ open: (workspaceId) => pouchBandPort(deps.open(workspaceId)) })

  return {
    bands: () => deps.bandIds(),
    isDeleted: (workspaceId) => deps.deleted.is(workspaceId),
    markDeleted: (workspaceId) => deps.deleted.mark(workspaceId),

    async create(workspaceId, name, founder) {
      await documents.createAccess(workspaceId, name, deps.hostId)
      // The same write rules the laptop puts into a band database: a band founded here can move to a laptop unchanged.
      await documents.writeRules(workspaceId)
      return accountsFor(workspaceId).provisionDevice(founder.founderId, founder.deviceId, true)
    },

    async remove(workspaceId) {
      // The app's database can be destroyed by the platform's own cleanup; a copy first, like the laptop (#362).
      const rows = await deps.open(workspaceId).allDocs({ startkey: '', endkey: '\ufff0', include_docs: true, attachments: true })
      const docs = rows.rows.flatMap((row) => (row.doc ? [row.doc as Record<string, unknown>] : []))
      await deps.copy(workspaceId, docs)
      await (deps.open(workspaceId) as BandDatabase & { destroy?: () => Promise<void> }).destroy?.()
    },

    accessCode: (workspaceId) => documents.accessCode(workspaceId),
    ensureAccessCode: (workspaceId, fallbackName) => documents.ensureAccessCode(workspaceId, fallbackName),
    rotateAccessCode: (workspaceId) => documents.rotateAccessCode(workspaceId),
    rename: (workspaceId, name) => documents.rename(workspaceId, name),
    setMasterMode: (workspaceId, masterMode) => documents.setMasterMode(workspaceId, masterMode),
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
    setDeviceRevoked: (workspaceId, deviceId, revoked) => documents.setDeviceRevoked(workspaceId, deviceId, revoked),
    forgetDevice: (workspaceId, deviceId) => documents.forgetDevice(workspaceId, deviceId),
    updateRules: (workspaceId) => documents.updateRules(workspaceId),
  }
}

/** The profiles of a band as the roster reads them - the tablet's own side of `band.profileDocs`. */
export async function profileDocsOf(db: BandDatabase): Promise<Record<string, unknown>[]> {
  const rows = await db.allDocs({ startkey: PROFILE_PREFIX, endkey: `${PROFILE_PREFIX}\ufff0`, include_docs: true })
  return rows.rows.flatMap((row) => (row.doc ? [row.doc as Record<string, unknown>] : []))
}

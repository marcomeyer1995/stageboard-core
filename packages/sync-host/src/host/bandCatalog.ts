import type { AdminProof, MasterMode } from 'shared-types'

/** An answer in the shape the shared route table takes - a status and a JSON body. */
export interface BandAnswer {
  status: number
  body?: unknown
}

/**
 * How a host stores its bands (host module, #962): the laptop over its database host, the tablet over the PouchDB
 * databases the app already holds. The life cycle's rules live in `createBandCatalog`, once for both; a host only
 * says how a band is made, read, changed and removed.
 */
export interface BandStore {
  /** The ids of every band this host holds. */
  bands(): Promise<string[]>
  /** Whether this host knows the band was deleted (it must never be founded again, #364). */
  isDeleted(workspaceId: string): boolean
  /** Remembers a deleted band - the store has already kept a copy of it. */
  markDeleted(workspaceId: string): void
  /** Creates the band's database with its write rules, access doc and the founder's own login. */
  create(workspaceId: string, name: string, founder: { founderId: string; deviceId: string }): Promise<{ username: string; password: string }>
  /** Deletes the band's database - after keeping a copy; refuses when no copy could be made. */
  remove(workspaceId: string): Promise<void>
  /** The band's standing access code and name, or null when it has no access doc yet. */
  accessCode(workspaceId: string): Promise<{ code: string; name: string } | null>
  /** Reads the access code, creating one on the spot for a band that predates it (the lazy backfill). */
  ensureAccessCode(workspaceId: string, fallbackName: string): Promise<{ code: string; name: string }>
  rotateAccessCode(workspaceId: string): Promise<string>
  rename(workspaceId: string, name: string): Promise<void>
  setMasterMode(workspaceId: string, masterMode: MasterMode): Promise<void>
  /** A login of that band, with its roles - null when it is not one. */
  login(workspaceId: string, username: string, password: string): Promise<{ name: string; roles: string[] } | null>
  /** Whether the login is an admin of that band, with the host's own lockout for wrong tries (a 4-digit PIN is
   * guessable in a minute otherwise, #396). */
  checkAdmin(workspaceId: string, username: string, password: string): Promise<boolean>
  /** Whether the login is an admin of any band on this host - the proof for founding another band (#364). */
  isAdminOfAnyBand(username: string, password: string): Promise<boolean>
  /** The Device Ledger's block: `unknown` for a device this band never saw. */
  setDeviceRevoked(workspaceId: string, deviceId: string, revoked: boolean): Promise<'ok' | 'unknown'>
  /** The Device Ledger's cleanup: `blocked` for a blocked device, `usedBy` for one a hardware device runs on. */
  forgetDevice(workspaceId: string, deviceId: string): Promise<'ok' | 'unknown' | 'blocked' | { usedBy: string[] }>
}

export interface BandCatalogOptions {
  store: BandStore
  /** The request comes from the host machine itself (the laptop's loopback) - no admin proof needed (#364). */
  isSelfRequest?: (remoteAddress: string | undefined) => boolean
}

export interface BandCreateRequest {
  workspaceId: string
  founderId: string
  workspaceName: string
  deviceId?: string
  adminUsername?: string
  adminPassword?: string
}

const error = (status: number, message: string, code?: string): BandAnswer => ({ status, body: { status: 'error', ...(code ? { code } : {}), message } })
const ok = (body?: unknown, status = 200): BandAnswer => (body === undefined ? { status } : { status, body })

/**
 * The band life cycle every host answers the same way (#962, Marco: "there is no Stage-Server any more - every device
 * can be host; only its power decides what it can do"). Founding, listing, deleting, renaming, the access code, the
 * master mode and the Device Ledger's block/remove. Public listing and band founding keep the proofs they had on the
 * laptop: a fresh host founds its first band freely, every later band needs an admin login of a band it already holds
 * (or the host machine itself).
 */
export function createBandCatalog(options: BandCatalogOptions) {
  const { store } = options

  /** The admin login proves it holds `admin` in that very band - a login of another band never counts. */
  const isAdmin = (workspaceId: string, proof: AdminProof): Promise<boolean> =>
    store.checkAdmin(workspaceId, proof.adminUsername, proof.adminPassword)

  return {
    async create(request: BandCreateRequest, remoteAddress?: string): Promise<BandAnswer> {
      const { workspaceId, founderId, workspaceName, deviceId } = request
      if (store.isDeleted(workspaceId)) {
        return error(409, 'This band was deleted - restore it via docs/03 §0b', 'deleted')
      }
      const bandDbs = await store.bands()
      // Accounts are tied to their band by name, so no band id may extend another one - band "x-y" would otherwise
      // own names that look like band "x"'s.
      if (bandDbs.some((other) => other !== workspaceId && (workspaceId.startsWith(`${other}-`) || other.startsWith(`${workspaceId}-`)))) {
        return error(400, 'Invalid band id')
      }
      // An existing band is public knowledge (`list` names them) - answered before the proof, so a repeat founding
      // never looks like a refused one.
      if (bandDbs.includes(workspaceId)) {
        return error(409, `Workspace already provisioned: ${workspaceId}`)
      }
      const self = options.isSelfRequest?.(remoteAddress) ?? false
      const proof =
        self || bandDbs.length === 0
          ? true
          : request.adminUsername && request.adminPassword
            ? await store.isAdminOfAnyBand(request.adminUsername, request.adminPassword)
            : false
      if (!proof) {
        return error(403, 'Only an admin of a band on this host can found another band', 'admin-required')
      }
      try {
        return ok(await store.create(workspaceId, workspaceName, { founderId, deviceId: deviceId ?? 'founding-device' }), 201)
      } catch (err) {
        if (err instanceof Error && /already provisioned/i.test(err.message)) return error(409, err.message)
        return error(502, err instanceof Error ? err.message : String(err))
      }
    },

    /** Public, like the WiFi list: band names alone are not a secret on the LAN the host itself controls. */
    async list(): Promise<BandAnswer> {
      const summaries = await Promise.all(
        (await store.bands()).map(async (workspaceId) => {
          const access = await store.ensureAccessCode(workspaceId, workspaceId)
          return { workspaceId, workspaceName: access.name }
        }),
      )
      return ok(summaries)
    },

    async remove(workspaceId: string, proof: AdminProof): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, proof))) return error(403, "Not this workspace's admin")
      await store.remove(workspaceId)
      store.markDeleted(workspaceId)
      return ok(undefined, 204)
    },

    async accessCode(workspaceId: string, proof: AdminProof): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, proof))) return error(403, "Not this workspace's admin")
      return ok({ code: (await store.ensureAccessCode(workspaceId, workspaceId)).code })
    },

    async rotateAccessCode(workspaceId: string, proof: AdminProof): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, proof))) return error(403, "Not this workspace's admin")
      return ok({ code: await store.rotateAccessCode(workspaceId) })
    },

    async rename(workspaceId: string, request: AdminProof & { name: string }): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, request))) return error(403, "Not this workspace's admin")
      await store.rename(workspaceId, request.name)
      return ok({ status: 'ok' })
    },

    async setMasterMode(workspaceId: string, request: AdminProof & { masterMode: MasterMode }): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, request))) return error(403, "Not this workspace's admin")
      await store.setMasterMode(workspaceId, request.masterMode)
      return ok({ status: 'ok' })
    },

    async revokeDevice(workspaceId: string, request: AdminProof & { deviceId: string; revoked: boolean }): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, request))) return error(403, "Not this workspace's admin")
      return (await store.setDeviceRevoked(workspaceId, request.deviceId, request.revoked)) === 'ok' ? ok(undefined, 204) : error(404, 'Unknown device')
    },

    async forgetDevice(workspaceId: string, request: AdminProof & { deviceId: string }): Promise<BandAnswer> {
      if (!(await isAdmin(workspaceId, request))) return error(403, "Not this workspace's admin")
      const result = await store.forgetDevice(workspaceId, request.deviceId)
      if (result === 'ok') return ok(undefined, 204)
      if (result === 'blocked') return error(409, 'blocked')
      if (result === 'unknown') return error(404, 'Unknown device')
      return { status: 409, body: { status: 'error', message: 'in-use', usedBy: result.usedBy } }
    },
  }
}

export type BandCatalog = ReturnType<typeof createBandCatalog>

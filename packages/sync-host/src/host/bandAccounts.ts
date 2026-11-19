import { basicCredentials, hex, pbkdf2, same } from '../passwords.js'

/**
 * The accounts of a band, kept in the band's own database (host module, #960): who may sign in with which
 * device, and the verifier of each admin's PIN. Every host - laptop or tablet - reads and writes the same
 * documents with this one code, and they travel between hosts with the rest of the band. There is no second
 * account store to keep in step.
 *
 * One document per login (`account:<username>`) and one per PIN (`anchor:<profileId>`), never a shared list:
 * two hosts that each add a device while apart never edit the same document, so nothing is lost when they meet.
 * Taking someone out keeps the document as `revoked` (without its verifier) so the removal replicates too.
 *
 * Only verifiers are stored (PBKDF2, the database's own fields), never a password. A PIN is 4 digits - its verifier
 * is only as strong as the band's trust in its devices (docs/25 §6h).
 */

/** A document of the band database as the accounts use it. */
export interface AccountDoc {
  _id: string
  _rev?: string
  name?: string
  profileId?: string
  roles?: string[]
  iterations?: number
  salt?: string
  derived_key?: string
  pbkdf2_prf?: string
  revoked?: boolean
}

/** The band database, as far as accounts need it. The host adapts its own store (PouchDB, the database-compatible). */
export interface AccountStore {
  get(id: string): Promise<AccountDoc | null>
  /** Writes the document, replacing whatever is stored under that id. */
  put(doc: AccountDoc): Promise<void>
  /** Every document whose id starts with `prefix`. */
  list(prefix: string): Promise<AccountDoc[]>
}

export interface BandAccountsOptions {
  store: AccountStore
  workspaceId: string
  /** PBKDF2 rounds for a new verifier. */
  iterations?: number
  /** How long a checked login is remembered (PBKDF2 is slow on a tablet). */
  rememberMs?: number
  /** The ids of the devices the band lists as its hosts. A login on one of them has the role `host` on top of its own
   * - what lets a host write the band's accounts with its own sync. Not stored with the login: a device that is taken
   * off the list loses it with the next check. Absent: no device has it. */
  hostDevices?: () => Promise<readonly string[]>
  /** The most logins remembered at once (500). A login that cannot be remembered is still answered - it only pays the
   * PBKDF2 again next time. */
  maxRemembered?: number
  now?: () => number
}

export interface BandAccounts {
  /** A login for one device of a person - a fresh random password every time, so a reissue stops the old one. */
  provisionDevice(profileId: string, deviceId: string, isAdmin: boolean): Promise<{ username: string; password: string }>
  /** Who this `Authorization` header is, or null. */
  login(authorization: string | undefined): Promise<{ name: string; roles: string[] } | null>
  setPin(profileId: string, pin: string): Promise<void>
  checkPin(profileId: string, pin: string): Promise<boolean>
  /** Whether this person has a PIN (a revoked one counts as none). */
  hasPin(profileId: string): Promise<boolean>
  /** Whether this person has any login or PIN that is not revoked - i.e. was let in before. */
  knownMember(profileId: string): Promise<boolean>
  /** Revokes every device login and the PIN of a person. */
  removeMember(profileId: string): Promise<void>
  /** How many checked logins are remembered right now (what the host holds on to). */
  rememberedCount(): number
  /** Gives every device login of a person the admin role, or takes it away. */
  setAdmin(profileId: string, isAdmin: boolean): Promise<void>
}

export const workspaceDbName = (workspaceId: string): string => `stageboard-${workspaceId}`
export const memberUsername = (workspaceId: string, profileId: string): string => `${workspaceDbName(workspaceId)}-${profileId}`
export const deviceUsername = (workspaceId: string, profileId: string, deviceId: string): string => `${memberUsername(workspaceId, profileId)}~${deviceId}`

const ACCOUNT = 'account:'
const ANCHOR = 'anchor:'
const MEMBER = ['member']
const ADMIN = ['member', 'admin']

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createBandAccounts(options: BandAccountsOptions): BandAccounts {
  const { store, workspaceId } = options
  const iterations = options.iterations ?? 10_000
  const rememberMs = options.rememberMs ?? 5 * 60_000
  const now = options.now ?? Date.now
  const remembered = new Map<string, { until: number; ctx: { name: string; roles: string[] } }>()
  const db = workspaceDbName(workspaceId)

  const verifier = async (secret: string) => {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
    return { iterations, salt, derived_key: await pbkdf2(secret, salt, iterations), pbkdf2_prf: 'sha256' }
  }
  const matches = async (doc: AccountDoc | null, secret: string): Promise<boolean> => {
    if (!doc || doc.revoked || !doc.salt || !doc.derived_key) return false
    return same(await pbkdf2(secret, doc.salt, doc.iterations ?? iterations, doc.pbkdf2_prf), doc.derived_key)
  }
  const maxRemembered = options.maxRemembered ?? 500
  /** Remembers a checked login - after forgetting the ones that ran out, and not at all when the cache is still full:
   * entries that are never asked for again (a login that was reissued) must not pile up. */
  const remember = (key: string, ctx: { name: string; roles: string[] }) => {
    if (remembered.size >= maxRemembered) {
      const t = now()
      for (const [k, v] of remembered) if (v.until <= t) remembered.delete(k)
    }
    if (remembered.size < maxRemembered) remembered.set(key, { until: now() + rememberMs, ctx })
  }
  /** Whether the login is one of a device the band lists as a host: the id after the `~` is the device id exactly. */
  const isHostDevice = async (username: string): Promise<boolean> => {
    if (!options.hostDevices) return false
    const deviceId = username.slice(username.lastIndexOf('~') + 1)
    if (!username.includes('~') || deviceId === '') return false
    try {
      return (await options.hostDevices()).includes(deviceId)
    } catch {
      // No settings yet, or not readable: no host role - never a reason to refuse the login itself.
      return false
    }
  }
  /** Every device login of a person (revoked ones included - a document stays). */
  const devicesOf = (profileId: string) => store.list(`${ACCOUNT}${memberUsername(workspaceId, profileId)}~`)

  return {
    async provisionDevice(profileId, deviceId, isAdmin) {
      const username = deviceUsername(workspaceId, profileId, deviceId)
      const password = randomPassword()
      await store.put({ _id: `${ACCOUNT}${username}`, name: username, roles: isAdmin ? ADMIN : MEMBER, ...(await verifier(password)) })
      return { username, password }
    },

    async login(authorization) {
      const creds = basicCredentials(authorization)
      if (!creds || !creds.user.startsWith(`${db}-`)) return null
      const key = authorization as string
      const hit = remembered.get(key)
      if (hit && hit.until > now()) return hit.ctx
      remembered.delete(key)
      const doc = await store.get(`${ACCOUNT}${creds.user}`)
      if (!doc || !(await matches(doc, creds.password))) return null
      const roles = doc.roles ?? []
      if (!roles.includes('member') && !roles.includes('admin')) return null
      const ctx = { name: creds.user, roles: (await isHostDevice(creds.user)) ? [...roles, 'host'] : roles }
      remember(key, ctx)
      return ctx
    },

    async setPin(profileId, pin) {
      await store.put({ _id: `${ANCHOR}${profileId}`, profileId, ...(await verifier(pin)) })
    },

    async checkPin(profileId, pin) {
      return matches(await store.get(`${ANCHOR}${profileId}`), pin)
    },

    rememberedCount: () => remembered.size,

    async hasPin(profileId) {
      const doc = await store.get(`${ANCHOR}${profileId}`)
      return !!doc && !doc.revoked && !!doc.derived_key
    },

    async knownMember(profileId) {
      if (await this.hasPin(profileId)) return true
      return (await devicesOf(profileId)).some((d) => !d.revoked)
    },

    async removeMember(profileId) {
      remembered.clear()
      for (const doc of await devicesOf(profileId)) {
        if (doc.revoked) continue
        await store.put({ _id: doc._id, ...(doc.name ? { name: doc.name } : {}), revoked: true })
      }
      const anchor = await store.get(`${ANCHOR}${profileId}`)
      if (anchor && !anchor.revoked) await store.put({ _id: anchor._id, profileId, revoked: true })
    },

    async setAdmin(profileId, isAdmin) {
      remembered.clear()
      for (const doc of await devicesOf(profileId)) {
        if (doc.revoked) continue
        await store.put({ ...doc, roles: isAdmin ? ADMIN : MEMBER })
      }
    },
  }
}

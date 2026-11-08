import { basicCredentials, pbkdf2, same } from './passwords.js'

/**
 * Logins on a host that has no account list of its own - an Android tablet (docs/25 §6b, Marco
 * 2026-11-07: "C"): each band database carries its devices' login keys in `host-accounts`, written
 * only by the Stage-Server. A device may use a band when its login is listed in *that* band's
 * document - so a tablet of another band, or a removed one, is turned away.
 */
export const HOST_ACCOUNTS_DOC_ID = 'host-accounts'

export interface HostAccount {
  name: string
  roles: string[]
  iterations: number
  salt: string
  derived_key: string
  pbkdf2_prf?: string
}

export interface HostLoginOptions {
  /** The band's listed device logins (its `host-accounts` document), empty when there is none. */
  accounts: (db: string) => Promise<HostAccount[]>
  /** How long a checked login is remembered - CouchDB's 600,000 PBKDF2 rounds take a while on a tablet. */
  rememberMs?: number
  now?: () => number
}

export type HostLogin = (authorization: string | undefined, db: string) => Promise<{ name: string; roles: string[] } | null>

export function createHostLogin(options: HostLoginOptions): HostLogin {
  const rememberMs = options.rememberMs ?? 5 * 60_000
  const now = options.now ?? Date.now
  const remembered = new Map<string, { until: number; ctx: { name: string; roles: string[] } }>()

  return async (authorization, db) => {
    const creds = basicCredentials(authorization)
    if (!creds) return null
    const key = `${db}\n${authorization}`
    const hit = remembered.get(key)
    if (hit && hit.until > now()) return hit.ctx
    remembered.delete(key)

    const account = (await options.accounts(db)).find((a) => a.name === creds.user)
    if (!account || !(account.roles.includes('member') || account.roles.includes('admin'))) return null
    const derived = await pbkdf2(creds.password, account.salt, account.iterations, account.pbkdf2_prf)
    if (!same(derived, account.derived_key)) return null
    const ctx = { name: account.name, roles: account.roles }
    remembered.set(key, { until: now() + rememberMs, ctx })
    return ctx
  }
}

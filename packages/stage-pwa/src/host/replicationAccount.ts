import type { HostAccount } from 'sync-host'
import { BandHostsSchema, type BandHostEntry } from 'shared-types'
import { verifyAccountRequest } from 'sync-host'

/**
 * The tablet's side of the returned primary's catch-up (host backup, #947, docs/25 §6e/§6g): once the
 * tablet has taken over, the primary comes back out of date and copies what was written meanwhile from
 * the tablet - it asks, signed with the band code, for a member login of this band (port of
 * core-backend's `createReplicationAccountIssuer`, #919). The login lives only here (not in the band's
 * synced `host-accounts` document - only the Stage-Server writes that) and is handed out once per
 * request: `sentAt` must rise, so a recorded request is worth nothing.
 */
export interface AccountIssuer {
  issue(raw: unknown): Promise<{ username: string; password: string } | null>
  /** The logins handed out so far, as the tablet's login check reads them. */
  accounts(): HostAccount[]
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

async function makeAccount(name: string, password: string): Promise<HostAccount> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  const iterations = 10_000
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' }, key, 256)
  return { name, roles: ['member'], iterations, salt, derived_key: hex(new Uint8Array(bits)), pbkdf2_prf: 'sha256' }
}

export function createAccountIssuer(deps: {
  selfHostId: string
  workspaceId: string
  hosts: () => readonly BandHostEntry[] | undefined
  key: () => Promise<CryptoKey | null>
  load: () => { lastSentAt: Record<string, number>; accounts: HostAccount[] } | null
  save: (state: { lastSentAt: Record<string, number>; accounts: HostAccount[] }) => void
}): AccountIssuer {
  const state = deps.load() ?? { lastSentAt: {}, accounts: [] }
  return {
    accounts: () => state.accounts,
    async issue(raw) {
      try {
        const hosts = BandHostsSchema.safeParse(deps.hosts())
        const key = await deps.key()
        if (!hosts.success || hosts.data.length < 2 || !key) return null
        const request = await verifyAccountRequest(raw, key)
        if (!request || request.hostId === deps.selfHostId || !hosts.data.some((h) => h.hostId === request.hostId)) return null
        if (request.sentAt <= (state.lastSentAt[request.hostId] ?? -1)) return null
        state.lastSentAt[request.hostId] = request.sentAt
        const username = `stageboard-${deps.workspaceId}-host~${request.hostId}`
        const password = hex(crypto.getRandomValues(new Uint8Array(24)))
        state.accounts = [...state.accounts.filter((a) => a.name !== username), await makeAccount(username, password)]
        deps.save(state)
        return { username, password }
      } catch {
        return null
      }
    },
  }
}

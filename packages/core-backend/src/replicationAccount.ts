import { BandHostsSchema, type BandHostEntry } from 'shared-types'
import { leaseKey, verifyAccountRequest } from './hostLeaseAuth.js'

export interface ReplicationAccountIssuer {
  /** A login for the other listed host to read this band with, or null if the request is not good. */
  issue(raw: unknown): Promise<{ username: string; password: string } | null>
}

/**
 * The primary's side of the passive copy (host backup, #919, docs/25 §6e): the backup asks, signed
 * with the band code (hostLeaseAuth.ts), for a login of this band to copy its database with. The
 * account is an ordinary member account of the band named after the host (`mint`), handed out only to
 * the *other* host the band lists, once per request - a request must carry a higher `sentAt` than the
 * last one of that host, so a recorded one is worth nothing.
 */
export function createReplicationAccountIssuer(deps: {
  selfHostId: string
  workspaceId: () => string | null
  readHosts: (workspaceId: string) => Promise<readonly BandHostEntry[] | null>
  readAccessCode: (workspaceId: string) => Promise<string | null>
  mint: (workspaceId: string, hostId: string) => Promise<{ username: string; password: string }>
}): ReplicationAccountIssuer {
  const lastSentAt = new Map<string, number>()
  return {
    async issue(raw) {
      try {
        const workspaceId = deps.workspaceId()
        if (!workspaceId) return null
        const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
        const code = await deps.readAccessCode(workspaceId)
        if (!hosts.success || hosts.data.length < 2 || !code) return null
        const request = verifyAccountRequest(raw, leaseKey(code, workspaceId))
        if (!request || request.hostId === deps.selfHostId || !hosts.data.some((h) => h.hostId === request.hostId)) return null
        if (request.sentAt <= (lastSentAt.get(request.hostId) ?? -1)) return null
        lastSentAt.set(request.hostId, request.sentAt)
        return await deps.mint(workspaceId, request.hostId)
      } catch {
        return null
      }
    },
  }
}

import { z } from 'zod'
import { BandHostsSchema, type BandHostEntry } from 'shared-types'
import { startBandReplication, type BandReplication, type ReplicationStatus } from './bandReplication.js'
import { leaseKey, signAccountRequest } from './hostLeaseAuth.js'

export interface RemoteTarget {
  baseUrl: string
  workspaceId: string
  /** The primary's certificate fingerprint from the band list - the copy must go over a connection pinned to it. */
  fingerprint: string | undefined
  auth: { username: string; password: string }
}

export interface ReplicationRunner {
  /** Starts the copy when this host is the backup and none runs yet (call every few seconds). Never throws. */
  tick(): Promise<void>
  /** The copy's state, or null before it has started. */
  status(): ReplicationStatus | null
  stop(): void
}

/** The default (#919): the backup (priority 2) copies from the primary (priority 1); anyone else copies nothing. */
const backupCopiesFromPrimary = (hosts: readonly BandHostEntry[], selfHostId: string): BandHostEntry | null =>
  hosts.find((h) => h.hostId === selfHostId)?.priority === 2 ? (hosts.find((h) => h.priority === 1) ?? null) : null

const AccountSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })

/**
 * Keeps the backup's copy of the band database going (host backup, #919, docs/25 §6e): asks the
 * primary for an account (signed with the band code), then copies the primary's database into this
 * host's own, by itself retrying when the primary is gone. The database handles are made by the
 * caller (`makeRemote` pinned to the primary's fingerprint, `makeLocal` creating the band's database
 * here if it is not there yet), so this can be tried on in-memory databases.
 */
export function createReplicationRunner(deps: {
  selfHostId: string
  workspaceId: () => string | null
  readHosts: (workspaceId: string) => Promise<unknown>
  readAccessCode: (workspaceId: string) => Promise<string | null>
  requestAccount: (url: string, body: unknown, fingerprint: string | undefined) => Promise<unknown>
  makeRemote: (target: RemoteTarget) => PouchDB.Database
  makeLocal: (workspaceId: string) => Promise<PouchDB.Database>
  /** Which host to copy from, or null for none. Default: the backup copies from the primary. A returned primary copies
   * from the backup until it has handed back (#935). */
  copyFrom?: (hosts: readonly BandHostEntry[], selfHostId: string) => BandHostEntry | null
  now: () => number
}): ReplicationRunner {
  let replication: BandReplication | null = null
  let startedFor: string | null = null
  let startedFrom: string | null = null
  let lastSentAt = 0
  let busy = false

  return {
    async tick() {
      if (busy) return
      busy = true
      try {
        const workspaceId = deps.workspaceId()
        // A copy of another band than the one served now is not wanted any more.
        if (replication && startedFor !== workspaceId) {
          replication.stop()
          replication = null
        }
        if (!workspaceId) return
        const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
        const code = await deps.readAccessCode(workspaceId)
        if (!hosts.success || hosts.data.length < 2 || !code) return
        const copyFrom = deps.copyFrom ?? backupCopiesFromPrimary
        const primary = copyFrom(hosts.data, deps.selfHostId)
        // Running: keep going while it is still wanted from the same host, else stop (a returned primary has handed back).
        if (replication) {
          if (primary && primary.url === startedFrom) return
          replication.stop()
          replication = null
        }
        if (!primary) return

        lastSentAt = Math.max(deps.now(), lastSentAt + 1)
        const baseUrl = primary.url.replace(/\/+$/, '')
        const answer = AccountSchema.safeParse(
          await deps.requestAccount(`${baseUrl}/host/replication-account`, signAccountRequest({ hostId: deps.selfHostId, sentAt: lastSentAt }, leaseKey(code, workspaceId)), primary.certFingerprint),
        )
        if (!answer.success) return
        replication = startBandReplication({
          remote: deps.makeRemote({ baseUrl, workspaceId, fingerprint: primary.certFingerprint, auth: answer.data }),
          local: await deps.makeLocal(workspaceId),
        })
        startedFor = workspaceId
        startedFrom = primary.url
      } catch {
        // The primary not being reachable is the normal case this exists for; the next tick tries again.
      } finally {
        busy = false
      }
    },
    status: () => replication?.status() ?? null,
    stop() {
      replication?.stop()
      replication = null
    },
  }
}

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { BandHostEntrySchema, BandHostsSchema, HostJoinInviteSchema, type BandHostEntry, type HostJoinInvite } from 'shared-types'

/**
 * A fresh backup joins a band (host backup, #933, docs/25 §6e). It reads the host list and the band
 * code from its own band database - which it only has after the first copy (#919) - so it must be
 * told once which band it backs up and where the primary is. The join file stands in until the copy
 * has brought the band's own list; the database wins as soon as it has two hosts. A file, not
 * documents seeded into the database: a seeded document and the primary's would clash when copied.
 */
export const BootstrapSchema = z.object({
  workspaceId: z.string().min(1),
  accessCode: z.string().min(1),
  hosts: BandHostsSchema,
  /** The largest `sentAt` of an invite this host accepted - a recorded invite cannot be replayed (#945). */
  lastInviteAt: z.number().int().nonnegative().optional(),
})
export type Bootstrap = z.infer<typeof BootstrapSchema>

export interface BandBootstrapStore {
  load(): Bootstrap | null
  save(bootstrap: Bootstrap): void
}

export function createBandBootstrapStore(stateDir: string): BandBootstrapStore {
  const file = join(stateDir, 'join-band.json')
  return {
    load() {
      try {
        const parsed = BootstrapSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
    save(bootstrap) {
      mkdirSync(stateDir, { recursive: true })
      // It holds the band code: readable by this host's owner only.
      writeFileSync(file, JSON.stringify(bootstrap), { mode: 0o600 })
      chmodSync(file, 0o600)
    },
  }
}

/** The host list to use: the band's own once it has two hosts, else the join file's (for its own band only). */
export function effectiveHosts(workspaceId: string, dbHosts: unknown, bootstrap: Bootstrap | null): readonly BandHostEntry[] | null {
  const own = BandHostsSchema.safeParse(dbHosts)
  if (own.success && own.data.length >= 2) return own.data
  return bootstrap && bootstrap.workspaceId === workspaceId ? bootstrap.hosts : null
}

const JoinInputSchema = z.object({
  workspaceId: z.string().trim().min(1),
  accessCode: z.string().trim().min(1),
  primaryUrl: z.string().url().startsWith('https://'),
  certFingerprint: BandHostEntrySchema.shape.certFingerprint,
})

export type JoinResult = { ok: true } | { ok: false; status: 400 | 403 | 409 | 500 | 502; message: string }

export async function joinBand(
  deps: {
    selfHostId: string
    /** This host's own address, as the other host of the band reaches it. */
    selfUrl: string
    activeWorkspaceId: () => string | null
    /** The primary's host id from its `/time`, null when it does not answer. */
    fetchPrimaryId: (url: string, fingerprint: string | undefined) => Promise<string | null>
    ensureLocalDb: (workspaceId: string) => Promise<void>
    activate: (workspaceId: string) => Promise<void>
    store: BandBootstrapStore
  },
  raw: unknown,
): Promise<JoinResult> {
  const input = JoinInputSchema.safeParse(raw)
  if (!input.success) return { ok: false, status: 400, message: input.error.issues[0]?.message ?? 'Invalid request' }
  const { workspaceId, accessCode, certFingerprint } = input.data
  const primaryUrl = input.data.primaryUrl.replace(/\/+$/, '')

  // One band's hardware runs on a host at a time: never take a host away from another band.
  const active = deps.activeWorkspaceId()
  if (active !== null && active !== workspaceId) return { ok: false, status: 409, message: 'This host already serves another band' }

  const primaryId = await deps.fetchPrimaryId(primaryUrl, certFingerprint)
  if (primaryId === null) return { ok: false, status: 502, message: 'The primary does not answer' }
  if (primaryId === deps.selfHostId) return { ok: false, status: 400, message: 'The primary is this host itself' }

  try {
    await deps.ensureLocalDb(workspaceId)
    deps.store.save({
      workspaceId,
      accessCode,
      hosts: [
        { hostId: primaryId, url: primaryUrl, ...(certFingerprint ? { certFingerprint } : {}), priority: 1 },
        { hostId: deps.selfHostId, url: deps.selfUrl, priority: 2 },
      ],
    })
    await deps.activate(workspaceId)
    return { ok: true }
  } catch {
    return { ok: false, status: 500, message: 'Could not set this host up for the band' }
  }
}

/**
 * A fresh backup joins the band because a host of that band invited it (#945): the primary sees the admin's
 * new entry in the band's host list, notices the backup serves no band yet, and sends the band's code with its
 * own address and fingerprint. The code is checked with the primary (its `/workspaces/:id/roster` is
 * code-gated), so a stranger who heard the address cannot name this host for their band. The invite's `sentAt`
 * must rise, so a recorded request is worth nothing. The admin only picks the host on the stage map.
 */
/** Alias kept local for the service's type; the wire schema lives in shared-types. */
const InviteSchema = HostJoinInviteSchema
export type JoinInvite = z.infer<typeof InviteSchema>

export function joinBandInvite(deps: {
  selfHostId: string
  selfUrl: string
  activeWorkspaceId: () => string | null
  /** True only if the primary confirms the band's code (and the fingerprint it presents). */
  verifyWithPrimary: (primaryUrl: string, workspaceId: string, accessCode: string, fingerprint: string | undefined) => Promise<string | null>
  ensureLocalDb: (workspaceId: string) => Promise<void>
  activate: (workspaceId: string) => Promise<void>
  store: BandBootstrapStore
  now: () => number
}): (raw: unknown) => Promise<JoinResult> {
  return async (raw) => {
    const invite = InviteSchema.safeParse(raw)
    if (!invite.success) return { ok: false, status: 400, message: invite.error.issues[0]?.message ?? 'Invalid invite' }
    const { workspaceId, accessCode, targetHostId, fingerprint } = invite.data
    if (targetHostId !== deps.selfHostId) return { ok: false, status: 400, message: 'This invite is for another host' }
    if (invite.data.sentAt > deps.now() + 60_000 || invite.data.sentAt < (deps.store.load()?.lastInviteAt ?? -1) + 1) {
      return { ok: false, status: 409, message: 'This invite is old or was already used' }
    }
    const active = deps.activeWorkspaceId()
    if (active !== null && active !== workspaceId) return { ok: false, status: 409, message: 'This host already serves another band' }

    const primaryUrl = invite.data.primaryUrl.replace(/\/+$/, '')
    let primaryId: string | null = null
    try {
      primaryId = await deps.verifyWithPrimary(primaryUrl, workspaceId, accessCode, fingerprint)
    } catch {
      return { ok: false, status: 502, message: 'The primary does not confirm the band' }
    }
    if (!primaryId) return { ok: false, status: 403, message: 'The primary did not accept the band code' }

    try {
      await deps.ensureLocalDb(workspaceId)
      const previous = deps.store.load()
      const hosts: BandHostEntry[] = [
        { hostId: primaryId ?? 'primary', url: primaryUrl, ...(fingerprint ? { certFingerprint: fingerprint } : {}), priority: 1 },
        { hostId: deps.selfHostId, url: deps.selfUrl, priority: 2 },
      ]
      // Keep a previous host list if it already knows the primary's real id (#914 writes it into the band).
      if (previous?.workspaceId === workspaceId && previous.hosts.length >= 2) {
        hosts[0]!.hostId = previous.hosts.find((h) => h.priority === 1)?.hostId ?? primaryId ?? 'primary'
        hosts[1] = { ...hosts[1]!, url: previous.hosts.find((h) => h.hostId === deps.selfHostId)?.url ?? deps.selfUrl }
      }
      deps.store.save({ workspaceId, accessCode, hosts, lastInviteAt: invite.data.sentAt })
      await deps.activate(workspaceId)
      return { ok: true }
    } catch {
      return { ok: false, status: 500, message: 'Could not set this host up for the band' }
    }
  }
}

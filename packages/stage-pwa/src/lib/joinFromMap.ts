import { HostJoinInviteSchema } from 'shared-types'

export type JoinInviteInput = {
  workspaceId: string
  accessCode: string
  primaryUrl: string
  primaryHostId: string
  targetHostId: string
  targetUrl: string
  /** The backup's certificate fingerprint from its `/time` answer. */
  fingerprint?: string
  sentAt: number
}

export type JoinAskResult = 'done' | 'code-refused' | 'refused' | 'unreachable'

/**
 * The stage map asking a fresh backup host to join the band (#945): the admin's band code goes to the
 * **backup host itself**, which checks it with the primary before it accepts. The sentAt makes a
 * recorded invite worthless. The shared Zod schema is the same one the host validates on arrival.
 */
export async function askBackupToJoin(input: JoinInviteInput): Promise<JoinAskResult> {
  if (!input.workspaceId || !input.accessCode) return 'refused'
  const parsed = HostJoinInviteSchema.safeParse({
    workspaceId: input.workspaceId,
    accessCode: input.accessCode,
    primaryUrl: input.primaryUrl,
    primaryHostId: input.primaryHostId,
    targetHostId: input.targetHostId,
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    sentAt: input.sentAt,
  })
  if (!parsed.success) return 'refused'
  try {
    const response = await fetch(`${input.targetUrl.replace(/\/+$/, '')}/host/join-band-from-map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) return 'done'
    if (response.status === 403) return 'code-refused'
    if (response.status === 400 || response.status === 409) return 'refused'
    return 'unreachable'
  } catch {
    return 'unreachable'
  }
}

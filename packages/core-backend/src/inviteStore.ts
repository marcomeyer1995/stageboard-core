import { randomInt } from 'node:crypto'

interface Invite {
  workspaceId: string
  workspaceName: string
  expiresAt: number
}

/**
 * In-memory, short-lived join codes (see #21, redesigned 2026-09-01 - see workspace.ts's
 * `WorkspaceInviteRequestSchema` doc comment) - same "one process, no persistence" shape as
 * plugin-health's `healthStore.ts`: an invite that dies with a Stage-Server restart is fine,
 * nobody expects a code minted before a restart to still work. Not single-use - reusable by
 * every joiner until it expires, matching one code shown on the admin's tablet that the whole
 * band scans/types in, one after another, each self-service-picking who they are.
 */
const invites = new Map<string, Invite>()

const INVITE_TTL_MS = 15 * 60 * 1000

function isExpired(invite: Invite): boolean {
  return invite.expiresAt <= Date.now()
}

function generateCode(): string {
  // 8 digits, zero-padded - matches the "Wi-Fi sharing"-style short code from #21's design,
  // not meant to be cryptographically unguessable on its own (its real protection is the
  // short TTL above, same trust model the raw workspace password already had).
  let code: string
  do {
    code = randomInt(0, 100_000_000).toString().padStart(8, '0')
  } while (invites.has(code) && !isExpired(invites.get(code)!))
  return code
}

export function createInvite(workspaceId: string, workspaceName: string): WorkspaceInviteResult {
  const code = generateCode()
  const expiresAt = Date.now() + INVITE_TTL_MS
  invites.set(code, { workspaceId, workspaceName, expiresAt })
  return { code, expiresAt }
}

export interface WorkspaceInviteResult {
  code: string
  expiresAt: number
}

export interface ResolvedInviteResult {
  workspaceId: string
  workspaceName: string
}

/** Null for an unknown or expired code - lazily evicts an expired entry it happens to hit,
 * rather than running a separate sweep. */
export function resolveInvite(code: string): ResolvedInviteResult | null {
  const invite = invites.get(code)
  if (!invite) return null
  if (isExpired(invite)) {
    invites.delete(code)
    return null
  }
  const { workspaceId, workspaceName } = invite
  return { workspaceId, workspaceName }
}

/** Test-only: this module's state is shared across the whole process by design - tests need a
 * way to reset it between runs. */
export function __resetInviteStoreForTests(): void {
  invites.clear()
}

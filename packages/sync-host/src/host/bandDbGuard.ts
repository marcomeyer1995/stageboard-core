import { basicCredentials } from '../passwords.js'
import type { PinThrottle } from './pinThrottle.js'
import type { SyncResponse } from '../index.js'

/**
 * The one guard in front of a band database (`/db/stageboard-<id>/…`) on every host (#964 step 2, Marco 2026-11-27: both rule sets on
 * every host). In this order:
 *
 * 1. a database name that climbs out (`.`/`..`, an encoded `/`) → 403;
 * 2. a band this host does not host → 404 (answering it as a wrong login would tell a device that the name is a band, #958);
 * 3. a band this host holds but does not serve right now (a passive backup) → 503, so the device follows the primary;
 * 4. no login → 401; a login of another band → 403;
 * 5. a login locked after too many wrong passwords → 429 (#396).
 *
 * The login itself (is the password right?) is the host's: the guard only says whether the request may get that far. After the answer,
 * `noteBandDbLogin` counts a wrong login (401) towards the lock and a good one clears it.
 */
export interface BandDbGuardDeps {
  /** Whether this host hosts the band at all; absent: every band it has. */
  servesBand?: (workspaceId: string) => boolean | Promise<boolean>
  /** Whether it serves the band right now; absent: it does. */
  serving?: (workspaceId: string) => boolean
  /** The lock after wrong logins, by username; absent: no lock. */
  loginThrottle?: PinThrottle
}

export type BandDbGuardResult =
  /** Not a band database path (the database root, a system database): the host decides. */
  | { kind: 'other' }
  | { kind: 'refused'; answer: SyncResponse; reason: string }
  | { kind: 'band'; db: string; workspaceId: string; username: string }

const refused = (status: number, error: string, reason: string, extra: Record<string, unknown> = {}): BandDbGuardResult => ({ kind: 'refused', reason, answer: { status, body: { error, reason, ...extra } } })

/** `path` is what follows the host's origin: `/db/<name>/…` or `<name>/…` (the tablet's native server strips nothing). */
export async function guardBandDb(path: string, authorization: string | undefined, deps: BandDbGuardDeps): Promise<BandDbGuardResult> {
  const rest = path.split('?')[0]!.replace(/^\/db(?=\/|$)/, '')
  // Only the first segment names the database; a document id further on may hold an encoded `/` (`%2F`).
  let db: string
  try {
    db = decodeURIComponent(rest.split('/').find((s) => s !== '') ?? '')
  } catch {
    return refused(403, 'forbidden', 'bad path')
  }
  if (db === '.' || db === '..' || db.includes('/')) return refused(403, 'forbidden', 'bad path')
  if (!db.startsWith('stageboard-')) return { kind: 'other' }
  const workspaceId = db.slice('stageboard-'.length)

  if (deps.servesBand && !(await deps.servesBand(workspaceId))) return refused(404, 'not_found', 'Not a band of this host.')
  if (deps.serving && !deps.serving(workspaceId)) return refused(503, 'passive', 'This host is not serving the band right now.')

  const username = basicCredentials(authorization)?.user ?? null
  if (!username) return refused(401, 'unauthorized', 'Not a device of this band.')
  if (!username.startsWith(`${db}-`)) return refused(403, 'forbidden', 'Not an account of this band.')
  const lockedFor = deps.loginThrottle?.lockedForSeconds(username) ?? 0
  if (lockedFor > 0) return refused(429, 'locked', 'Too many wrong logins.', { retryAfterSeconds: lockedFor })
  return { kind: 'band', db, workspaceId, username }
}

/** After the host answered a band database request: a 401 counts towards the lock, a success clears it. True if this one just locked it. */
export function noteBandDbLogin(throttle: PinThrottle | undefined, username: string, status: number): boolean {
  if (!throttle) return false
  if (status === 401) return throttle.recordFailure(username)
  if (status < 400) throttle.recordSuccess(username)
  return false
}

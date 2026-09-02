import { randomBytes, randomInt } from 'node:crypto'
import {
  allDocs,
  createUser,
  deleteDb,
  deleteUser,
  ensureDb,
  getDoc,
  listDbs,
  putDoc,
  putSecurity,
  resetUserPassword,
  setUserRoles,
  userExists,
  type CouchConfig,
  type CouchDoc,
} from './couch.js'

/** Matches `localDbName()`/the CouchDB username convention in stage-pwa's workspaceDb.ts -
 * client and server must derive the same names from a workspaceId independently. */
export function workspaceDbName(workspaceId: string): string {
  return `stageboard-${workspaceId}`
}

/**
 * Per-person-accounts follow-up: every roster member gets their own CouchDB user, not a
 * shared one - `profileId` (the roster entry's own id, from `Profile.id`/`profiles:<id>` doc
 * ids, see `workspaceCollection.ts`'s `${kind}:${id}` scheme) makes each username unique per
 * person per workspace.
 */
export function memberUsername(workspaceId: string, profileId: string): string {
  return `${workspaceDbName(workspaceId)}-${profileId}`
}

const PROFILE_ID_PREFIX = 'profiles:'

/**
 * `_design/roster`'s validator, set once at workspace founding and never regenerated (see
 * `provisionWorkspace` below) - a role check, not a name check, so it never needs to change as
 * members are added/removed/promoted. `userCtx.roles` reflects the authenticated user's own
 * CouchDB roles (whatever `createUser`/`setUserRoles` gave them), the same mechanism a true
 * CouchDB server admin's `_admin` role is exposed through (verified live against a real
 * instance - a *database*-level `_security.admins` entry, unlike a server admin, is NOT
 * automatically exempt from validate_doc_update, so this still has to check explicitly - it
 * just checks a role now instead of one hardcoded username). Deliberately plain ES5 - runs
 * inside CouchDB's own sandboxed JS engine, not Node.
 */
const ROSTER_VALIDATOR_SOURCE = `function(newDoc, oldDoc, userCtx) {
  if (newDoc._id.indexOf('profiles:') === 0 && userCtx.roles.indexOf('admin') === -1) {
    throw({forbidden: 'Only a band admin may edit the roster.'});
  }
}`

export class WorkspaceAlreadyProvisionedError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace already provisioned: ${workspaceId}`)
    this.name = 'WorkspaceAlreadyProvisionedError'
  }
}

export interface WorkspaceCredentialPair {
  username: string
  password: string
}

function randomPassword(): string {
  return randomBytes(24).toString('base64url')
}

/** A fresh 4-digit numeric PIN (2026-09-02 second follow-up) - zero-padded, so always exactly 4
 * characters (`randomInt(0, 10_000)` alone would drop leading zeros). Used anywhere a *human*
 * needs to read/retype an admin PIN (the "Passwort zurücksetzen" panel action, and as the
 * initial PIN when an admin account is first provisioned with none supplied); the silent,
 * never-typed reissue paths (a non-admin's every pick, or an admin logging in via the universal
 * recovery code) keep using `randomPassword()` instead - there's no reason to burn a short,
 * guessable PIN on a value nobody will ever need to type. */
function randomPin(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0')
}

/**
 * Creates a workspace: its database, a `_security` doc, a `_design/roster` validator, the
 * founding device's own personal CouchDB account (`roles: ['member', 'admin']` - the founder is
 * this band's first admin, same "first profile is admin" rule `useProfilesStore.ts`'s `create`
 * already applies to the roster doc itself), and its standing access code (`workspace:access`
 * doc, see `getOrCreateAccessCode` below - 2026-09-01 WiFi-style redesign). `config` must carry
 * admin credentials - only core-backend's own trusted `couch` config is ever passed here, never
 * anything reachable from a tablet.
 *
 * `_security` and the roster validator are role-based and deliberately never touched again
 * after this call (see `ROSTER_VALIDATOR_SOURCE` above) - every subsequent member
 * (`provisionMember` below) just gets created with the right role and is immediately covered,
 * no further writes to either doc.
 *
 * Never rotates an existing account's password: a repeat call for an id that's already
 * provisioned (checked via the founder's own user) throws `WorkspaceAlreadyProvisionedError`
 * instead, since silently changing it would lock out a tablet that already paired with it.
 */
export async function provisionWorkspace(
  config: CouchConfig,
  workspaceId: string,
  founderId: string,
  workspaceName: string,
): Promise<WorkspaceCredentialPair> {
  const username = memberUsername(workspaceId, founderId)

  if (await userExists(config, username)) {
    throw new WorkspaceAlreadyProvisionedError(workspaceId)
  }

  const password = randomPassword()
  const db = workspaceDbName(workspaceId)

  await createUser(config, username, password, ['member', 'admin'])
  await ensureDb(config, db)
  await putSecurity(config, db, {
    admins: { names: [], roles: ['admin'] },
    members: { names: [], roles: ['member', 'admin'] },
  })
  await putDoc(config, db, { _id: '_design/roster', validate_doc_update: ROSTER_VALIDATOR_SOURCE })
  await createAccessCodeDoc(config, workspaceId, workspaceName)

  return { username, password }
}

const ACCESS_CODE_DOC_ID = 'workspace:access'

interface AccessCodeDoc extends CouchDoc {
  code: string
  name: string
}

function generateAccessCode(): string {
  // 8 digits, zero-padded - the "WiFi password" a band writes down/prints once, not a
  // cryptographically-unguessable secret on its own (its real protection is that it's only
  // ever handed out over the LAN the Stage-Server itself controls, same trust level the old
  // ephemeral invite code and the raw workspace password before it both already had).
  return randomInt(0, 100_000_000).toString().padStart(8, '0')
}

/** Always creates a fresh `workspace:access` doc, overwriting any existing one - the initial
 * creation at `provisionWorkspace` time, and the "lazy backfill" fallback in
 * `getOrCreateAccessCode` below share this. Not exported: every real caller goes through one of
 * those two, which know exactly when a fresh doc is actually warranted. */
async function createAccessCodeDoc(config: CouchConfig, workspaceId: string, name: string): Promise<string> {
  const code = generateAccessCode()
  await putDoc(config, workspaceDbName(workspaceId), { _id: ACCESS_CODE_DOC_ID, code, name })
  return code
}

/** Reads a workspace's standing access code and display name - `null` if this workspace
 * predates the 2026-09-01 redesign and has never had one created (see `getOrCreateAccessCode`
 * below for the lazy-backfill path that actually every real caller uses). */
export async function getAccessCode(config: CouchConfig, workspaceId: string): Promise<{ code: string; name: string } | null> {
  const doc = await getDoc<AccessCodeDoc>(config, workspaceDbName(workspaceId), ACCESS_CODE_DOC_ID)
  return doc ? { code: doc.code, name: doc.name } : null
}

/**
 * The actual entry point every route uses (`GET /workspaces`, `POST /workspaces/:id/roster`,
 * `POST /workspaces/:id/join/:profileId`) - reads the standing code, lazily creating one with
 * `fallbackName` if this workspace was founded before the 2026-09-01 redesign and has never had
 * a `workspace:access` doc at all. This is what makes a pre-existing workspace (like the one
 * that triggered this redesign - Marco locked out of every device at once, with no admin
 * session left anywhere to mint anything) transparently start working the moment this ships,
 * with no separate migration step: the very first request against it creates its code on the
 * spot. `fallbackName` has no better source for a workspace this old - the server never learned
 * a real name before this redesign either (see `WorkspaceProvisionRequestSchema`'s doc comment) -
 * so callers pass the raw `workspaceId` as a last resort, readable enough to distinguish bands
 * by ID even if the display name isn't pretty.
 */
export async function getOrCreateAccessCode(
  config: CouchConfig,
  workspaceId: string,
  fallbackName: string,
): Promise<{ code: string; name: string }> {
  const existing = await getAccessCode(config, workspaceId)
  if (existing) return existing
  const code = await createAccessCodeDoc(config, workspaceId, fallbackName)
  return { code, name: fallbackName }
}

/** Rotates a workspace's standing access code to a fresh one, keeping its display name -
 * admin-only (`POST /workspaces/:id/access-code/rotate`), e.g. "the code leaked" or just
 * post-tour cleanup. Immediately invalidates the old code for anyone who only knew that one. */
export async function rotateAccessCode(config: CouchConfig, workspaceId: string): Promise<string> {
  const existing = await getAccessCode(config, workspaceId)
  return createAccessCodeDoc(config, workspaceId, existing?.name ?? workspaceId)
}

/** Every workspace the Stage-Server hosts, with a real (or lazily-backfilled) display name -
 * `GET /workspaces`, the WiFi "which networks are in range" listing, public/no auth by design
 * (see `WorkspaceSummarySchema`'s doc comment - a band's name alone isn't sensitive on a LAN
 * the Stage-Server itself controls). Filters `_all_dbs` down to `stageboard-*` databases
 * (matching `workspaceDbName`), excluding CouchDB's own system databases. */
export async function listWorkspaces(config: CouchConfig): Promise<Array<{ workspaceId: string; workspaceName: string }>> {
  const dbs = await listDbs(config)
  const workspaceIds = dbs.filter((db) => db.startsWith('stageboard-')).map((db) => db.slice('stageboard-'.length))

  return Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const { name } = await getOrCreateAccessCode(config, workspaceId, workspaceId)
      return { workspaceId, workspaceName: name }
    }),
  )
}

/**
 * Provisions one additional roster member's personal CouchDB account (see per-person-accounts
 * follow-up) - nothing else needs touching, `_security`/`_design/roster` are role-based and
 * already cover any user created with the right role. `createUser` itself is already idempotent
 * (swallows "already exists", never rotates a password), so this doesn't need its own guard.
 */
export async function provisionMember(
  config: CouchConfig,
  workspaceId: string,
  profileId: string,
  password: string,
  isAdmin: boolean,
): Promise<WorkspaceCredentialPair> {
  const username = memberUsername(workspaceId, profileId)
  await createUser(config, username, password, isAdmin ? ['member', 'admin'] : ['member'])
  return { username, password }
}

/** Generates a fresh random password for a new member - split out from `provisionMember` so a
 * caller (index.ts's member-creation route) can decide *when* to use a random one vs. an
 * admin-supplied PIN before provisioning. */
export function generateMemberPassword(): string {
  return randomPassword()
}

/**
 * Sets an already-provisioned member's password to an explicit, caller-chosen value - the
 * building block for both self-service PIN assignment (`index.ts`'s `set-pin` route: an admin
 * choosing their *own* new 4-digit PIN) and the admin-panel reset below (choosing a *fresh*
 * value on someone else's behalf). Unlike `provisionMember`/`createUser`, this *does* rotate an
 * existing account's password on purpose - any device already synced with the old one stops
 * authenticating until it's told the new one.
 */
export async function setMemberPassword(
  config: CouchConfig,
  workspaceId: string,
  profileId: string,
  password: string,
): Promise<WorkspaceCredentialPair> {
  const username = memberUsername(workspaceId, profileId)
  await resetUserPassword(config, username, password)
  return { username, password }
}

/**
 * Silently (re)issues an already-provisioned member's password to a fresh, long, never-typed
 * random one - used where nobody ever needs to read or retype the value, only where the app
 * itself stores and uses it: a non-admin's every single pick (2026-09-02 second follow-up - a
 * non-admin has no password concept a human could type at all anymore, so every activation just
 * transparently reissues a working account), and an admin logging in via the universal recovery
 * code (`resolveOutcome` in index.ts - the device ends up with valid credentials either way,
 * with no need to burn a short human-memorable PIN on a value that's about to be immediately
 * overwritten by the device's own stored session).
 */
export async function resetMemberPassword(
  config: CouchConfig,
  workspaceId: string,
  profileId: string,
): Promise<WorkspaceCredentialPair> {
  return setMemberPassword(config, workspaceId, profileId, randomPassword())
}

/**
 * Resets another admin's PIN to a fresh, *human-relayable* 4-digit one - the admin-panel
 * "Passwort zurücksetzen" escape hatch (BandManagementView.tsx), for when a locked-out admin has
 * another admin's help available. Deliberately a short PIN, not `resetMemberPassword`'s long
 * random one: the whole point here is that a person reads this value off one screen and retypes
 * it into another, which a 24-byte base64 string makes needlessly painful.
 */
export async function resetAdminPin(config: CouchConfig, workspaceId: string, profileId: string): Promise<WorkspaceCredentialPair> {
  return setMemberPassword(config, workspaceId, profileId, randomPin())
}

/** Grants or revokes admin for one already-provisioned member (see per-person-accounts
 * follow-up) - a single targeted roles update, nothing else touched. Caller is responsible for
 * the "at least one admin must remain" check (index.ts's routes, since only they know the full
 * current admin count from the roster). */
export async function setMemberAdmin(
  config: CouchConfig,
  workspaceId: string,
  profileId: string,
  isAdmin: boolean,
): Promise<void> {
  await setUserRoles(config, memberUsername(workspaceId, profileId), isAdmin ? ['member', 'admin'] : ['member'])
}

/** Deprovisions one member's personal CouchDB account (see per-person-accounts follow-up) -
 * just deletes their user; `_security`/`_design/roster` need no change (role-based, and a
 * deleted user obviously can't authenticate as anyone regardless). */
export async function deprovisionMember(config: CouchConfig, workspaceId: string, profileId: string): Promise<void> {
  await deleteUser(config, memberUsername(workspaceId, profileId))
}

/**
 * Irreversibly destroys a workspace: every member's personal CouchDB account, then the database
 * itself. Caller (index.ts's `DELETE /workspaces/:id` route) is responsible for verifying the
 * requester actually holds an admin credential before calling this - this function itself just
 * does the deletion, no further authorization check.
 *
 * Reads the roster *first* (has to - once the database is gone there's nothing left to read) to
 * find every member's `profileId` and derive their username, since core-backend keeps no
 * separate registry of who's been provisioned - the roster itself is the only record.
 *
 * Doesn't - and can't - notify any other device that already joined this workspace; they only
 * discover it's gone the next time their own sync fails. No mechanism for that exists yet.
 */
export async function deprovisionWorkspace(config: CouchConfig, workspaceId: string): Promise<void> {
  const db = workspaceDbName(workspaceId)
  const profiles = await allDocs<CouchDoc>(config, db, {
    startkey: PROFILE_ID_PREFIX,
    endkey: `${PROFILE_ID_PREFIX}￰`,
  }).catch(() => [])

  await deleteDb(config, db)

  for (const profile of profiles) {
    const profileId = profile._id.slice(PROFILE_ID_PREFIX.length)
    await deleteUser(config, memberUsername(workspaceId, profileId))
  }
}

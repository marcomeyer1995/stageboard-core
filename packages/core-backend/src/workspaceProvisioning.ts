import { randomBytes } from 'node:crypto'
import {
  allDocs,
  createUser,
  deleteDb,
  deleteUser,
  ensureDb,
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

/**
 * Creates a workspace: its database, a `_security` doc, a `_design/roster` validator, and the
 * founding device's own personal CouchDB account (`roles: ['member', 'admin']` - the founder is
 * this band's first admin, same "first profile is admin" rule `useProfilesStore.ts`'s `create`
 * already applies to the roster doc itself). `config` must carry admin credentials - only
 * core-backend's own trusted `couch` config is ever passed here, never anything reachable from
 * a tablet.
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

  return { username, password }
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
 * Resets an already-provisioned member's password to a fresh random one - the admin
 * "forgot/never knew the password" escape hatch (2026-08-31: BandManagementView.tsx's
 * "Einladen" always goes through this now, rather than asking the admin to already know and
 * re-type the account's password). Unlike `provisionMember`/`createUser`, this *does* rotate an
 * existing account's password on purpose - any device already synced with the old one stops
 * authenticating until it's re-invited with the new one, an accepted tradeoff of "forgot my
 * password" always meaning "the old one no longer works anywhere."
 */
export async function resetMemberPassword(
  config: CouchConfig,
  workspaceId: string,
  profileId: string,
): Promise<WorkspaceCredentialPair> {
  const username = memberUsername(workspaceId, profileId)
  const password = randomPassword()
  await resetUserPassword(config, username, password)
  return { username, password }
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

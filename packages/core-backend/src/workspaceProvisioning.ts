import { randomInt } from 'node:crypto'
import type { BandAccounts } from 'sync-host'
import { ROSTER_VALIDATOR_SOURCE } from 'sync-host'
import {
  deleteDb,
  ensureDb,
  getDoc,
  listDbs,
  putDoc,
  putDocWithRetry,
  putSecurity,
  type DatabaseConfig,
  type DatabaseDoc,
} from './database.js'
import { saveDeletedBand } from './deletedBand.js'
import { recordDeletedWorkspace } from './provisioningAuth.js'

/** The names every device derives on its own from a workspace id (stage-pwa's workspaceDb.ts, #960): one definition, in sync-host. */
export { deviceUsername, memberUsername, workspaceDbName } from 'sync-host'
import { workspaceDbName } from 'sync-host'

const PROFILE_ID_PREFIX = 'profiles:'

export { ROSTER_VALIDATOR_SOURCE } from 'sync-host'

/**
 * Brings `_design/roster` of every band on this server up to the current validator - it used to be
 * written once at founding only, so bands founded before a rule was added (protected dashboard
 * templates, #16) would never get it. Returns the bands whose validator was replaced.
 */
export async function updateRosterValidators(config: DatabaseConfig, onError?: (db: string, err: unknown) => void): Promise<string[]> {
  const updated: string[] = []
  for (const db of await listDbs(config)) {
    if (!db.startsWith('stageboard-')) continue
    // One band's database failing must not leave every band after it on the old rules (#401 review).
    try {
      const current = await getDoc<DatabaseDoc & { validate_doc_update?: string }>(config, db, '_design/roster')
      if (current === null || current.validate_doc_update === ROSTER_VALIDATOR_SOURCE) continue
      await putDocWithRetry<DatabaseDoc & { validate_doc_update?: string }>(config, db, '_design/roster', (existing) => ({
        ...(existing ?? { _id: '_design/roster' }),
        validate_doc_update: ROSTER_VALIDATOR_SOURCE,
      }))
      updated.push(db)
    } catch (err) {
      onError?.(db, err)
    }
  }
  return updated
}

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

/**
 * Creates a workspace: its database, a `_security` doc, a `_design/roster` validator, the
 * founding device's own personal account (`roles: ['member', 'admin']` - the founder is
 * this band's first admin, same "first profile is admin" rule `useProfilesStore.ts`'s `create`
 * already applies to the roster doc itself), and its standing access code (`workspace:access`
 * doc, see `getOrCreateAccessCode` below - 2026-09-01 WiFi-style redesign). `config` must carry
 * admin credentials - only core-backend's own trusted `database` config is ever passed here, never
 * anything reachable from a tablet.
 *
 * `_security` and the roster validator are role-based (see `ROSTER_VALIDATOR_SOURCE` above) - every
 * subsequent member (`provisionMember` below) just gets created with the right role and is
 * immediately covered. `_security` is never written again; the validator is brought up to date
 * at every server start (`updateRosterValidators`, since #16) - don't hand-patch it in a band DB.
 *
 * Never rotates an existing account's password: a repeat call for an id that's already
 * provisioned (checked via the founder's own user) throws `WorkspaceAlreadyProvisionedError`
 * instead, since silently changing it would lock out a tablet that already paired with it.
 */
export async function provisionWorkspace(
  config: DatabaseConfig,
  workspaceId: string,
  founderId: string,
  workspaceName: string,
  /** The founding device gets its own login (an admin's), like every device. */
  founder: { accounts: BandAccounts; deviceId: string },
): Promise<WorkspaceCredentialPair> {
  const db = workspaceDbName(workspaceId)

  // A band that already has its database is already provisioned: founding it again would hand a stranger an admin login.
  if ((await listDbs(config)).includes(db)) {
    throw new WorkspaceAlreadyProvisionedError(workspaceId)
  }

  await ensureDb(config, db)
  await putSecurity(config, db, {
    admins: { names: [], roles: ['admin'] },
    members: { names: [], roles: ['member', 'admin'] },
  })
  await putDoc(config, db, { _id: '_design/roster', validate_doc_update: ROSTER_VALIDATOR_SOURCE })
  await createAccessCodeDoc(config, workspaceId, workspaceName)

  return founder.accounts.provisionDevice(founderId, founder.deviceId, true)
}

const ACCESS_CODE_DOC_ID = 'workspace:access'

interface AccessCodeDoc extends DatabaseDoc {
  code: string
  name: string
  /** #85 - absent means 'device'. */
  masterMode?: 'device' | 'account'
}

function generateAccessCode(): string {
  // 8 digits, zero-padded - the "WiFi password" a band writes down/prints once, not a
  // cryptographically-unguessable secret on its own (its real protection is that it's only
  // ever handed out over the LAN the Host itself controls, same trust level the old
  // ephemeral invite code and the raw workspace password before it both already had).
  return randomInt(0, 100_000_000).toString().padStart(8, '0')
}

/** Always writes a fresh code, overwriting any existing doc's - the initial creation at
 * `provisionWorkspace` time, and the "lazy backfill" fallback in `getOrCreateAccessCode` below
 * share this. Not exported: every real caller goes through one of those two, which know exactly
 * when a fresh doc is actually warranted. Uses `putDocWithRetry` (database.ts) rather than a plain
 * fetch-then-put - the database rejects a PUT to an existing doc with no `_rev` as a 409 (confirmed
 * against a real instance; the mocked tests here don't catch this on their own), and unlike
 * `rotateAccessCode`/`renameWorkspace` below there's no separate earlier read whose `_rev` this
 * could reuse, so `putDocWithRetry`'s own fetch-then-put is exactly what's needed here too. */
async function createAccessCodeDoc(config: DatabaseConfig, workspaceId: string, name: string): Promise<string> {
  const code = generateAccessCode()
  await putDocWithRetry<AccessCodeDoc>(config, workspaceDbName(workspaceId), ACCESS_CODE_DOC_ID, (existing) => ({
    _id: ACCESS_CODE_DOC_ID,
    _rev: existing?._rev,
    code,
    name,
    ...(existing?.masterMode ? { masterMode: existing.masterMode } : {}),
  }))
  return code
}

/** Reads a workspace's standing access code and display name - `null` if this workspace
 * predates the 2026-09-01 redesign and has never had one created (see `getOrCreateAccessCode`
 * below for the lazy-backfill path that actually every real caller uses). */
export async function getAccessCode(config: DatabaseConfig, workspaceId: string): Promise<{ code: string; name: string } | null> {
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
  config: DatabaseConfig,
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
 * post-tour cleanup. Immediately invalidates the old code for anyone who only knew that one.
 * Reads the existing name from the same fetch `putDocWithRetry` already needs for `_rev` -
 * rather than a separate `getAccessCode` call first - so this costs exactly one round trip per
 * attempt, not two. */
export async function rotateAccessCode(config: DatabaseConfig, workspaceId: string): Promise<string> {
  const code = generateAccessCode()
  await putDocWithRetry<AccessCodeDoc>(config, workspaceDbName(workspaceId), ACCESS_CODE_DOC_ID, (existing) => ({
    _id: ACCESS_CODE_DOC_ID,
    _rev: existing?._rev,
    code,
    name: existing?.name ?? workspaceId,
    ...(existing?.masterMode ? { masterMode: existing.masterMode } : {}),
  }))
  return code
}

/** Renames a workspace (#58) - the mirror image of `rotateAccessCode`: keeps the existing
 * standing access code, only the `name` field changes (same single-fetch-per-attempt shape as
 * `rotateAccessCode` above, for the same reason). Reuses the same `workspace:access` doc rather
 * than a separate metadata doc, so it needs no new sync plumbing at all - it already replicates
 * to every already-joined device via the ordinary workspace-db sync (`workspaceDb.ts`'s
 * `startWorkspaceSync`), the exact gap the issue's "warum entfernt" section identified in the
 * old, client-only `renameWorkspace`. A workspace with no `workspace:access` doc yet
 * (pre-2026-09-01, never backfilled) gets one created on the spot, same lazy-backfill approach
 * as `getOrCreateAccessCode`. */
export async function renameWorkspace(config: DatabaseConfig, workspaceId: string, name: string): Promise<void> {
  await putDocWithRetry<AccessCodeDoc>(config, workspaceDbName(workspaceId), ACCESS_CODE_DOC_ID, (existing) => ({
    _id: ACCESS_CODE_DOC_ID,
    _rev: existing?._rev,
    code: existing?.code ?? generateAccessCode(),
    name,
    ...(existing?.masterMode ? { masterMode: existing.masterMode } : {}),
  }))
}

/** Sets who holds the Master-Token (#85) on the band's access doc, keeping code and name. */
export async function setMasterMode(config: DatabaseConfig, workspaceId: string, masterMode: 'device' | 'account'): Promise<void> {
  await putDocWithRetry<AccessCodeDoc>(config, workspaceDbName(workspaceId), ACCESS_CODE_DOC_ID, (existing) => ({
    _id: ACCESS_CODE_DOC_ID,
    _rev: existing?._rev,
    code: existing?.code ?? generateAccessCode(),
    name: existing?.name ?? workspaceId,
    masterMode,
  }))
}

/** Every workspace the Host hosts, with a real (or lazily-backfilled) display name -
 * `GET /workspaces`, the WiFi "which networks are in range" listing, public/no auth by design
 * (see `WorkspaceSummarySchema`'s doc comment - a band's name alone isn't sensitive on a LAN
 * the Host itself controls). Filters `_all_dbs` down to `stageboard-*` databases
 * (matching `workspaceDbName`), excluding the database's own system databases. */
export async function listWorkspaces(config: DatabaseConfig): Promise<Array<{ workspaceId: string; workspaceName: string }>> {
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
 * Deletes a band: its database - and with it every login and PIN verifier, which are documents of that database
 * (#960) - and records the id so it is never provisioned again through POST /workspaces (#364). A copy is kept first
 * (`saveDeletedBand`, #362) - the database host destroys what it deletes - and a band whose copy could not be made is
 * not deleted.
 */
export async function deprovisionWorkspace(config: DatabaseConfig, workspaceId: string): Promise<void> {
  await saveDeletedBand(config, workspaceId, process.env.STAGEBOARD_STATE_DIR ?? './data')
  await deleteDb(config, workspaceDbName(workspaceId))
  recordDeletedWorkspace(workspaceId)
}

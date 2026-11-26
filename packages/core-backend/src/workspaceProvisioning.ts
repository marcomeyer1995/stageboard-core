import type { BandAccounts } from 'sync-host'
import { createBandDocuments, ROSTER_VALIDATOR_SOURCE } from 'sync-host'
import {
  bandDocumentPort,
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
 * Brings `_design/roster` of every band on this host up to the current validator - it used to be
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
 * at every host start (`updateRosterValidators`, since #16) - don't hand-patch it in a band DB.
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
  await laptopBandDocuments(config).createAccess(workspaceId, workspaceName)

  return founder.accounts.provisionDevice(founderId, founder.deviceId, true)
}

/**
 * The band's access doc (standing code, name, master mode) and the Device Ledger's documents are sync-host's rules
 * (`createBandDocuments`, #964) - the same on the tablet host. These are the laptop's entries to them, over its database.
 */
export const laptopBandDocuments = (config: DatabaseConfig) => createBandDocuments({ open: (workspaceId) => bandDocumentPort(config, workspaceDbName(workspaceId)) })

/** The band's standing access code and display name - null for a band that predates the standing code (2026-09-01) and never had one. */
export async function getAccessCode(config: DatabaseConfig, workspaceId: string): Promise<{ code: string; name: string } | null> {
  return laptopBandDocuments(config).accessCode(workspaceId)
}

/**
 * The entry every route uses (`GET /workspaces`, `POST /workspaces/:id/roster`, the join): reads the standing code, creating one on the
 * spot for a band founded before the 2026-09-01 redesign - that is what let a band whose devices were all locked out work again the
 * moment it shipped, with no migration step. `fallbackName` is the raw id for a band that old (the host never learned a name then).
 */
export async function getOrCreateAccessCode(config: DatabaseConfig, workspaceId: string, fallbackName: string): Promise<{ code: string; name: string }> {
  return laptopBandDocuments(config).ensureAccessCode(workspaceId, fallbackName)
}

/** A fresh standing code, keeping the name (admin-only): the old code stops working for anyone who only knew that one. */
export async function rotateAccessCode(config: DatabaseConfig, workspaceId: string): Promise<string> {
  return laptopBandDocuments(config).rotateAccessCode(workspaceId)
}

/** Renames a band (#58): the access doc replicates to every device that joined, so the name reaches everyone. */
export async function renameWorkspace(config: DatabaseConfig, workspaceId: string, name: string): Promise<void> {
  await laptopBandDocuments(config).rename(workspaceId, name)
}

/** Who holds the Master-Token (#85), on the band's access doc. */
export async function setMasterMode(config: DatabaseConfig, workspaceId: string, masterMode: 'device' | 'account'): Promise<void> {
  await laptopBandDocuments(config).setMasterMode(workspaceId, masterMode)
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

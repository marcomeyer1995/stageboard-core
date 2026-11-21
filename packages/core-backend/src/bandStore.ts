import type { BandAccounts, BandStore } from 'sync-host'
import { workspaceDbName } from 'sync-host'
import { allDocs, deleteDocUnless, getDoc, listDbs, putDocWithRetry, type DatabaseConfig, type DatabaseDoc } from './database.js'
import { readDeletedWorkspaces, recordDeletedWorkspace } from './provisioningAuth.js'
import {
  deprovisionWorkspace,
  getAccessCode,
  getOrCreateAccessCode,
  provisionWorkspace,
  renameWorkspace,
  rotateAccessCode,
  setMasterMode,
} from './workspaceProvisioning.js'

/** The Device Ledger document (#958) as the block/remove routes read and write it. */
interface DeviceDoc extends DatabaseDoc {
  revoked?: boolean
  executionTarget?: string | null
  name?: string
}

export interface LaptopBandStoreDeps {
  database: DatabaseConfig
  accountsFor: (workspaceId: string) => BandAccounts
  /** An admin login of any band on this host (#364) - the laptop keeps its own throttle for it. */
  isAdminOfAnyBand: (username: string, password: string) => Promise<boolean>
  /** That band's admin, with the laptop's lockout for wrong tries. */
  checkAdmin: (workspaceId: string, username: string, password: string) => Promise<boolean>
}

/**
 * The laptop's bands (#962): the same life cycle every host answers, over its database host and the band accounts
 * that live in each band's database. The tablet implements the same `BandStore` over the PouchDB databases the app
 * already holds - the rules are `sync-host`'s `createBandCatalog`.
 */
export function createLaptopBandStore(deps: LaptopBandStoreDeps): BandStore {
  const { database } = deps
  const basic = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

  return {
    bands: async () => (await listDbs(database)).filter((db) => db.startsWith('stageboard-')).map((db) => db.slice('stageboard-'.length)),
    isDeleted: (workspaceId) => readDeletedWorkspaces().includes(workspaceId),
    markDeleted: (workspaceId) => recordDeletedWorkspace(workspaceId),
    create: (workspaceId, name, founder) =>
      provisionWorkspace(database, workspaceId, founder.founderId, name, { accounts: deps.accountsFor(workspaceId), deviceId: founder.deviceId }),
    remove: (workspaceId) => deprovisionWorkspace(database, workspaceId),
    accessCode: (workspaceId) => getAccessCode(database, workspaceId),
    ensureAccessCode: (workspaceId, fallbackName) => getOrCreateAccessCode(database, workspaceId, fallbackName),
    rotateAccessCode: (workspaceId) => rotateAccessCode(database, workspaceId),
    rename: (workspaceId, name) => renameWorkspace(database, workspaceId, name),
    setMasterMode: (workspaceId, masterMode) => setMasterMode(database, workspaceId, masterMode),
    login: async (workspaceId, username, password) => deps.accountsFor(workspaceId).login(basic(username, password)),
    checkAdmin: (workspaceId, username, password) => deps.checkAdmin(workspaceId, username, password),
    isAdminOfAnyBand: (username, password) => deps.isAdminOfAnyBand(username, password),
    setDeviceRevoked: async (workspaceId, deviceId, revoked) => {
      const db = workspaceDbName(workspaceId)
      const docId = `devices:${deviceId}`
      const existing = await getDoc<DeviceDoc>(database, db, docId)
      if (!existing) return 'unknown'
      await putDocWithRetry<DeviceDoc>(database, db, docId, (current) => ({
        ...(current ?? existing),
        revoked,
        _id: docId,
        _rev: current?._rev ?? existing._rev,
      }))
      return 'ok'
    },
    forgetDevice: async (workspaceId, deviceId) => {
      const db = workspaceDbName(workspaceId)
      const docId = `devices:${deviceId}`
      const existing = await getDoc<DeviceDoc>(database, db, docId)
      if (!existing) return 'unknown'
      if (existing.revoked) return 'blocked'
      const hardware = await allDocs<DatabaseDoc & { name?: string; executionTarget?: string | null }>(database, db, {
        startkey: 'logical-devices:',
        endkey: 'logical-devices:\ufff0',
      })
      const usedBy = hardware.filter((doc) => doc.executionTarget === deviceId).map((doc) => doc.name ?? doc._id)
      if (usedBy.length > 0) return { usedBy }
      // Checked and deleted against the same revision; a write in between is a conflict - read again and check again
      // instead of answering 204 for a delete that never happened (#426 review).
      const result = await deleteDocUnless<DeviceDoc, 'blocked'>(database, db, docId, (current) => (current.revoked ? 'blocked' : null))
      return result === 'missing' ? 'unknown' : result === 'blocked' ? 'blocked' : 'ok'
    },
  }
}

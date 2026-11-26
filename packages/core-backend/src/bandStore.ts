import type { BandAccounts, BandStore } from 'sync-host'
import { listDbs, type DatabaseConfig } from './database.js'
import { readDeletedWorkspaces, recordDeletedWorkspace } from './provisioningAuth.js'
import { deprovisionWorkspace, laptopBandDocuments, provisionWorkspace } from './workspaceProvisioning.js'

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
  const documents = laptopBandDocuments(database)
  const basic = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

  return {
    bands: async () => (await listDbs(database)).filter((db) => db.startsWith('stageboard-')).map((db) => db.slice('stageboard-'.length)),
    isDeleted: (workspaceId) => readDeletedWorkspaces().includes(workspaceId),
    markDeleted: (workspaceId) => recordDeletedWorkspace(workspaceId),
    create: (workspaceId, name, founder) =>
      provisionWorkspace(database, workspaceId, founder.founderId, name, { accounts: deps.accountsFor(workspaceId), deviceId: founder.deviceId }),
    remove: (workspaceId) => deprovisionWorkspace(database, workspaceId),
    accessCode: (workspaceId) => documents.accessCode(workspaceId),
    ensureAccessCode: (workspaceId, fallbackName) => documents.ensureAccessCode(workspaceId, fallbackName),
    rotateAccessCode: (workspaceId) => documents.rotateAccessCode(workspaceId),
    rename: (workspaceId, name) => documents.rename(workspaceId, name),
    setMasterMode: (workspaceId, masterMode) => documents.setMasterMode(workspaceId, masterMode),
    login: async (workspaceId, username, password) => deps.accountsFor(workspaceId).login(basic(username, password)),
    checkAdmin: (workspaceId, username, password) => deps.checkAdmin(workspaceId, username, password),
    isAdminOfAnyBand: (username, password) => deps.isAdminOfAnyBand(username, password),
    // The Device Ledger's block and cleanup are sync-host's rules, the same on the tablet host (#964).
    setDeviceRevoked: (workspaceId, deviceId, revoked) => documents.setDeviceRevoked(workspaceId, deviceId, revoked),
    forgetDevice: (workspaceId, deviceId) => documents.forgetDevice(workspaceId, deviceId),
  }
}

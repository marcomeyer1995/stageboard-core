import { createBandAccounts, type AccountDoc, type AccountStore, type BandAccounts } from 'sync-host'
import { allDocs, getDoc, putDocWithRetry, type DatabaseConfig, type DatabaseDoc } from './database.js'
import { workspaceDbName } from './workspaceProvisioning.js'

/**
 * The band accounts (`sync-host`'s `createBandAccounts`, #960) as the Host holds them: documents of the
 * band's database, read and written over HTTP as the server admin - the very same documents the built-in
 * database host signs devices in with, and the tablet writes. One instance per band, so the remembered logins
 * of one band are never another's, and a change made here is forgotten at once.
 */
type AccountDatabaseDoc = AccountDoc & DatabaseDoc

function storeFor(config: DatabaseConfig, db: string): AccountStore {
  return {
    // A database error is an error, never "no such account": it must not look like a person without a PIN.
    get: (id) => getDoc<AccountDatabaseDoc>(config, db, id),
    put: (doc) => putDocWithRetry<AccountDatabaseDoc>(config, db, doc._id, (existing) => ({ ...doc, ...(existing?._rev ? { _rev: existing._rev } : {}) })),
    list: (prefix) => allDocs<AccountDoc>(config, db, { startkey: prefix, endkey: `${prefix}￰` }).catch(() => []),
  }
}

export type BandAccountsFor = (workspaceId: string) => BandAccounts

export function createBandAccountsFor(
  config: DatabaseConfig,
  options: {
    iterations?: number
    /** The ids of the devices a band lists as its hosts - they get the role `host` (see `createBandAccounts`). */
    hostDevices?: (workspaceId: string) => Promise<readonly string[]>
  } = {},
): BandAccountsFor {
  const perBand = new Map<string, BandAccounts>()
  return (workspaceId) => {
    let accounts = perBand.get(workspaceId)
    if (!accounts) {
      accounts = createBandAccounts({
        store: storeFor(config, workspaceDbName(workspaceId)),
        workspaceId,
        ...(options.iterations ? { iterations: options.iterations } : {}),
        ...(options.hostDevices ? { hostDevices: () => options.hostDevices!(workspaceId) } : {}),
      })
      perBand.set(workspaceId, accounts)
    }
    return accounts
  }
}

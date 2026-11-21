import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import ReplicationPlugin from 'pouchdb-replication'
import type { DatabaseConfig } from './database.js'
import { ensureDb, putSecurity } from './database.js'
import { createPinnedFetch } from './pinnedFetch.js'
import type { RemoteTarget } from 'sync-host'
import { workspaceDbName } from './workspaceProvisioning.js'

PouchDB.plugin(HttpAdapter)
PouchDB.plugin(ReplicationPlugin)

/** The primary's band database over the `/db` proxy, with the account the primary issued and a
 * connection pinned to its certificate fingerprint (host backup, #919). */
export function makeRemoteBandDb(target: RemoteTarget): PouchDB.Database {
  return new PouchDB(`${target.baseUrl}/db/${workspaceDbName(target.workspaceId)}`, {
    adapter: 'http',
    auth: target.auth,
    fetch: createPinnedFetch(target.fingerprint) as unknown as typeof fetch,
  })
}

/** This host's own database of the band, created here (with the same access rules as at founding)
 * when the backup has never had the band. The roster validator comes across with the copy
 * (`_design/roster` replicates); `_security` does not, so it is set here. */
export async function makeLocalBandDb(database: DatabaseConfig, workspaceId: string): Promise<PouchDB.Database> {
  const db = workspaceDbName(workspaceId)
  await ensureDb(database, db)
  await putSecurity(database, db, { admins: { names: [], roles: ['admin'] }, members: { names: [], roles: ['member', 'admin'] } })
  return new PouchDB(`${database.url.replace(/\/$/, '')}/${encodeURIComponent(db)}`, { adapter: 'http', auth: { username: database.user, password: database.password } })
}

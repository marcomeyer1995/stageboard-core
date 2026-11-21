import { workspaceDbName } from 'sync-host'
import { putDocWithRetry, type DatabaseConfig, type DatabaseDoc } from '../database.js'

/**
 * A host is a device of the band like a tablet (#964): it registers itself in the band's device list under its `hostId`, marked `host`, so the Device
 * Ledger and the stage map know it by name and every binding to its hardware points at a real entry. It keeps what the band has made of the entry
 * (an admin's name for it, when it was first seen) and refreshes only `lastSeenAt`.
 */
export function hostDeviceDoc(existing: DatabaseDoc | null, hostId: string, name: string, now: number): DatabaseDoc {
  if (existing) return { ...existing, lastSeenAt: now }
  return { _id: `devices:${hostId}`, id: hostId, name, lastSeenAt: now, firstSeenAt: now, revoked: false, host: true }
}

export async function registerHostDevice(database: DatabaseConfig, workspaceId: string, hostId: string, name: string, now = Date.now()): Promise<void> {
  await putDocWithRetry<DatabaseDoc>(database, workspaceDbName(workspaceId), `devices:${hostId}`, (existing) => hostDeviceDoc(existing, hostId, name, now))
}

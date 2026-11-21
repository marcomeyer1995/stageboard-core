import { latencyProfileId, LEGACY_HOST_TARGET } from 'shared-types'
import { allDocs, deleteDocUnless, putDoc, type DatabaseConfig, type DatabaseDoc } from '../database.js'
import { workspaceDbName } from 'sync-host'

/**
 * The reserved word `'server'` (#964): what older bands stored for "the host's own hardware". A band now names the host by its id, like a tablet is named by
 * its id. The host that serves the band rewrites what it finds, once per start - idempotent, and nothing is lost: a value already stored under the host
 * id wins over the legacy one.
 */
export interface BandDocs {
  logicalDevices: DatabaseDoc[]
  latencyProfiles: DatabaseDoc[]
  transportConfigs: DatabaseDoc[]
  equipment: DatabaseDoc[]
  front: DatabaseDoc[]
}

export interface MigrationPlan {
  puts: DatabaseDoc[]
  deletes: string[]
}

const withoutRev = ({ _rev: _drop, ...rest }: DatabaseDoc): DatabaseDoc => rest

export function planHostTargetMigration(docs: BandDocs, hostId: string): MigrationPlan {
  const puts: DatabaseDoc[] = []
  const deletes: string[] = []
  const taken = new Set([...docs.latencyProfiles, ...docs.transportConfigs].map((d) => d._id))

  for (const doc of docs.logicalDevices) {
    if (doc.executionTarget === LEGACY_HOST_TARGET) puts.push({ ...doc, executionTarget: hostId })
  }
  for (const doc of docs.latencyProfiles) {
    if (doc.deviceId !== LEGACY_HOST_TARGET) continue
    const id = latencyProfileId(hostId, String(doc.output), (doc.route as Parameters<typeof latencyProfileId>[2]) ?? null)
    deletes.push(doc._id)
    if (!taken.has(`latency-profile:${id}`)) puts.push({ ...withoutRev(doc), _id: `latency-profile:${id}`, id, deviceId: hostId })
  }
  for (const doc of docs.transportConfigs) {
    if (doc.deviceId !== LEGACY_HOST_TARGET) continue
    const id = `${hostId}:${String(doc.logicalDeviceId)}`
    deletes.push(doc._id)
    if (!taken.has(`device-transport-config:${id}`)) puts.push({ ...withoutRev(doc), _id: `device-transport-config:${id}`, id, deviceId: hostId })
  }
  for (const doc of docs.equipment) {
    const apps = doc.appIds
    if (Array.isArray(apps) && apps.includes(LEGACY_HOST_TARGET)) puts.push({ ...doc, appIds: [...new Set(apps.map((a) => (a === LEGACY_HOST_TARGET ? hostId : a)))] })
  }
  for (const doc of docs.front) {
    if (doc.appId === LEGACY_HOST_TARGET) puts.push({ ...doc, appId: hostId })
  }
  return { puts, deletes }
}

const range = (prefix: string) => ({ startkey: prefix, endkey: `${prefix}￰` })

/** Reads the band's documents, rewrites the ones that still use the legacy word. Returns how many it changed. */
export async function migrateHostTarget(database: DatabaseConfig, workspaceId: string, hostId: string): Promise<number> {
  const db = workspaceDbName(workspaceId)
  const read = (prefix: string) => allDocs<DatabaseDoc>(database, db, range(prefix))
  const docs: BandDocs = {
    logicalDevices: await read('logical-devices:'),
    latencyProfiles: await read('latency-profile:'),
    transportConfigs: await read('device-transport-config:'),
    equipment: await read('stage-equipment:'),
    front: await read('stage-front:'),
  }
  const plan = planHostTargetMigration(docs, hostId)
  for (const doc of plan.puts) await putDoc(database, db, doc)
  for (const id of plan.deletes) await deleteDocUnless(database, db, id, () => null)
  return plan.puts.length + plan.deletes.length
}

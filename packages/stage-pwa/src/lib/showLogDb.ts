import type { ShowLogEvent } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type ShowLogEventDoc = Doc<ShowLogEvent>

const showLog = createWorkspaceCollection<ShowLogEvent>('showlog')

export const getShowLogDb = showLog.getDb
export const switchShowLogWorkspace = showLog.switchWorkspace
export const getAllShowLogEvents = showLog.getAll
export const putShowLogEvent = showLog.put
export const showLogChanges = showLog.changes

/**
 * A show kept from deletion (#610), band-wide: one document per protected show, id = its showId;
 * no document = not protected. Beside the log, not an event in it - a later "protected" event
 * would count as the show's latest activity ("Geprobt … in den letzten Shows").
 */
export interface ShowProtection {
  id: string
  protectedAt: number
  byProfileId: string | null
}

const showProtection = createWorkspaceCollection<ShowProtection>('show-protection')

export const switchShowProtectionWorkspace = showProtection.switchWorkspace
export const getAllShowProtections = showProtection.getAll
export const putShowProtection = showProtection.put
export const removeShowProtection = showProtection.remove
export const showProtectionChanges = showProtection.changes

/** Removes every event of these shows in one write - a show is nothing but its events. The
 * deletions replicate like any other change, so the show is gone on every device. */
export async function deleteShowEvents(showIds: readonly string[]): Promise<number> {
  const wanted = new Set(showIds)
  const docs = (await showLog.getAll()).filter((doc) => wanted.has(doc.showId))
  if (docs.length === 0) return 0
  await showLog.getDb().bulkDocs(docs.map((doc) => ({ _id: doc._id, _rev: doc._rev, _deleted: true })) as never)
  return docs.length
}

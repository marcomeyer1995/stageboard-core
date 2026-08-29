import type { ShowLogEvent } from 'shared-types'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type ShowLogEventDoc = Doc<ShowLogEvent>

const showLog = createWorkspaceCollection<ShowLogEvent>('showlog')

export const getShowLogDb = showLog.getDb
export const switchShowLogWorkspace = showLog.switchWorkspace
export const getAllShowLogEvents = showLog.getAll
export const putShowLogEvent = showLog.put
export const showLogChanges = showLog.changes

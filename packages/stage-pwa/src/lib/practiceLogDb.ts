import type { PracticeLogEntry } from 'shared-types'
import { createWorkspaceCollection } from './workspaceCollection'

/** Practice takes (Solo Üben) - in the band database so a person's devices count together. */
const practiceLog = createWorkspaceCollection<PracticeLogEntry>('practice-log')

export const switchPracticeLogWorkspace = practiceLog.switchWorkspace
export const getAllPracticeLog = practiceLog.getAll
export const putPracticeLogEntry = practiceLog.put
export const practiceLogChanges = practiceLog.changes

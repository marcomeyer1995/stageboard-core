import type { AlignmentSession } from 'shared-types'
import { createWorkspaceCollection } from './workspaceCollection'

/** The running "Abgleich nach Gehör" (docs/21 §4) - band-wide, one document at most. */
const sessions = createWorkspaceCollection<AlignmentSession>('alignment-session')

export const switchAlignmentSessionWorkspace = sessions.switchWorkspace
export const getAllAlignmentSessions = sessions.getAll
export const putAlignmentSession = sessions.put
export const updateAlignmentSession = sessions.update
export const removeAlignmentSession = sessions.remove
export const alignmentSessionChanges = sessions.changes

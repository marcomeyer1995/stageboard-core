import type { ActionSequence } from './actions'
import { createWorkspaceCollection } from './workspaceCollection'

/** Named sequences of actions ("Abläufe", docs/23 §3) - band-wide, like widget buttons. */
const sequences = createWorkspaceCollection<ActionSequence>('action-sequence')

export const switchActionSequencesWorkspace = sequences.switchWorkspace
export const getAllActionSequences = sequences.getAll
export const putActionSequence = sequences.put
export const removeActionSequence = sequences.remove
export const actionSequencesChanges = sequences.changes

import type { SavedLoop } from './savedLoops'
import { createWorkspaceCollection } from './workspaceCollection'

/** Saved practice loops (#683) - their own documents, not a field of the variant: the song
 * editor saves whole variants, and a loop saved meanwhile on another tablet would be lost. */
const savedLoops = createWorkspaceCollection<SavedLoop>('saved-loop')

export const switchSavedLoopsWorkspace = savedLoops.switchWorkspace
export const getAllSavedLoops = savedLoops.getAll
export const putSavedLoop = savedLoops.put
export const removeSavedLoop = savedLoops.remove
export const savedLoopsChanges = savedLoops.changes

/** Drops a variant's loops along with the variant. */
export async function removeLoopsOfVariant(variantId: string): Promise<void> {
  for (const loop of await getAllSavedLoops()) {
    if (loop.variantId === variantId) await removeSavedLoop(loop.id)
  }
}

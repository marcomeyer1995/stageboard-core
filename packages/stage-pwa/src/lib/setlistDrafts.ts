import type { Setlist } from 'shared-types'

type Change = (setlist: Setlist) => Setlist

/**
 * While a setlist is open in SetlistDetail's editor, changes from outside the editor - a song
 * dropped on it, a swipe on the active setlist - go into its draft. Written straight to the
 * stored setlist instead, the editor would not show them and its next "Speichern" would write
 * the old draft over them (found in the #430 review).
 */
const openDrafts = new Map<string, (change: Change) => void>()

/** SetlistDetail registers its draft while editing; returns the unregister function. */
export function registerSetlistDraft(setlistId: string, apply: (change: Change) => void): () => void {
  openDrafts.set(setlistId, apply)
  return () => {
    if (openDrafts.get(setlistId) === apply) openDrafts.delete(setlistId)
  }
}

/** Applies `change` to the open draft of `setlistId`; false if that setlist is not being edited. */
export function changeSetlistDraft(setlistId: string, change: Change): boolean {
  const apply = openDrafts.get(setlistId)
  if (!apply) return false
  apply(change)
  return true
}

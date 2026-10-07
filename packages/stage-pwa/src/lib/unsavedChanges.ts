import { useEffect, useRef } from 'react'
import { useDialogStore } from '../store/useDialogStore'
import { useUnsavedChangesWarning } from './backNavigation'

/**
 * No silent data loss (Marco, 2026-10-07): an editor with unsaved changes registers here, and
 * every way out of it - Back, "← Bibliothek", another list entry, the ☰ menu - first calls
 * `confirmLeave()`, which asks "Speichern / Verwerfen / Weiter bearbeiten". Reloading or closing
 * the page can only get the browser's own warning (it allows no custom buttons).
 */
interface Guard {
  save: () => Promise<boolean>
}

const guards: Guard[] = []

/** Registers the calling editor while `dirty`. `save` resolves true once stored, false if it
 * could not save (e.g. invalid input - the editor shows why and stays open). */
export function useUnsavedChangesGuard(dirty: boolean, save: () => Promise<boolean>): void {
  const latest = useRef(save)
  latest.current = save
  useUnsavedChangesWarning(dirty)
  useEffect(() => {
    if (!dirty) return
    const guard: Guard = { save: () => latest.current() }
    guards.push(guard)
    return () => {
      const index = guards.indexOf(guard)
      if (index !== -1) guards.splice(index, 1)
    }
  }, [dirty])
}

export function hasUnsavedChanges(): boolean {
  return guards.length > 0
}

/** True when it is fine to leave: nothing unsaved, saved now, or explicitly discarded. */
export async function confirmLeave(): Promise<boolean> {
  const guard = guards[guards.length - 1]
  if (!guard) return true
  const choice = await useDialogStore.getState().askUnsaved()
  if (choice === 'save') return guard.save()
  return choice === 'discard'
}

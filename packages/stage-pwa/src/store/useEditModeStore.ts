import { create } from 'zustand'

interface EditModeState {
  isEditing: boolean
  /** Edit mode was opened from the menu's dashboard list ("Bearbeiten" → pen / new dashboard). */
  returnToMenu: boolean
  /** Set when such an edit ends: the menu reopens with its list in "Bearbeiten" (Marco,
   * 2026-10-07: finishing a dashboard should lead back to where it was started). */
  reopenMenuEditing: boolean
  setEditing: (isEditing: boolean, options?: { fromMenu?: boolean }) => void
  consumeReopenMenu: () => void
}

/**
 * The "Edit-Lock" from docs/07: during a show the dashboard is strictly read-only.
 * Deliberately NOT persisted - after every reload the UI comes back locked, so a
 * forgotten edit session can't turn into a mis-drag on stage.
 */
export const useEditModeStore = create<EditModeState>((set, get) => ({
  isEditing: false,
  returnToMenu: false,
  reopenMenuEditing: false,
  setEditing: (isEditing, options) =>
    isEditing
      ? set({ isEditing: true, returnToMenu: options?.fromMenu ?? false })
      : set({ isEditing: false, returnToMenu: false, reopenMenuEditing: get().isEditing && get().returnToMenu }),
  consumeReopenMenu: () => set({ reopenMenuEditing: false }),
}))

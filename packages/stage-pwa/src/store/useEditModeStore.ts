import { create } from 'zustand'

interface EditModeState {
  isEditing: boolean
  setEditing: (isEditing: boolean) => void
}

/**
 * The "Edit-Lock" from docs/07: during a show the dashboard is strictly read-only.
 * Deliberately NOT persisted - after every reload the UI comes back locked, so a
 * forgotten edit session can't turn into a mis-drag on stage.
 */
export const useEditModeStore = create<EditModeState>((set) => ({
  isEditing: false,
  setEditing: (isEditing) => set({ isEditing }),
}))

import { create } from 'zustand'

export interface EditingTitle {
  title: string
  variantLabel: string
}

interface EditingTitleState {
  /** Set while an editor page is open - the status bar names this instead of the queue's song. */
  editing: EditingTitle | null
  setEditing: (editing: EditingTitle | null) => void
}

/**
 * What an editor page is working on (#603, Marco 2026-10-20): on the phone there's no room for
 * the song's name in the editor's own header, and the status bar - not needed while editing -
 * showed the queue's song instead, which looked like the edited one. While an editor is open the
 * bar shows this, always (also while the queue plays); its state, faults and sync stay.
 */
export const useEditingTitleStore = create<EditingTitleState>((set) => ({
  editing: null,
  setEditing: (editing) => set({ editing }),
}))

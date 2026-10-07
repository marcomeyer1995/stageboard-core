import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const PRACTICE_WINDOW_DAYS = [7, 14, 30, 90] as const

interface LibraryPrefsState {
  /** What "Geübt" counts: own Solo-Üben takes in the last N days - per device (Marco, 2026-10-07). */
  practiceDays: number
  setPracticeDays: (days: number) => void
}

export const useLibraryPrefsStore = create<LibraryPrefsState>()(
  persist(
    (set) => ({
      practiceDays: 30,
      setPracticeDays: (practiceDays) => set({ practiceDays }),
    }),
    { name: 'stageboard-library-prefs' },
  ),
)

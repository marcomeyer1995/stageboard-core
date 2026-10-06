import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** How Stage-Messenger messages and song alerts show on this device (#26): a see-through strip at
 * the top that touches pass through (default - the musician keeps playing from the dashboard),
 * the whole screen (e.g. a drummer who reads nothing else), or not at all. */
export type FlashMode = 'banner' | 'fullscreen' | 'off'

interface FlashPrefs {
  mode: FlashMode
  setMode: (mode: FlashMode) => void
}

export const useFlashPrefsStore = create<FlashPrefs>()(
  persist((set) => ({ mode: 'banner', setMode: (mode) => set({ mode }) }), {
    name: 'stageboard-flash-prefs',
    version: 1,
    // Version 0 had `enabled: boolean` (on = the full-screen overlay of the first version).
    migrate: (persisted) => {
      const old = persisted as { enabled?: boolean } | undefined
      return { mode: old?.enabled === false ? 'off' : 'banner' } as FlashPrefs
    },
  }),
)

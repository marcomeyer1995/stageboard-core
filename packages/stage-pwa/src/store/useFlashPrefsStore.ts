import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** How Stage-Messenger messages and song alerts show on this device (#26): a see-through strip at
 * the top that touches pass through (default - the musician keeps playing from the dashboard),
 * the whole screen (e.g. a drummer who reads nothing else), or not at all. */
export type FlashMode = 'banner' | 'fullscreen' | 'off'

/** How long a message stays, seconds: the slider's range and default (Marco: adjustable). */
export const FLASH_SECONDS = { min: 3, max: 20, default: 8 } as const

interface FlashPrefs {
  mode: FlashMode
  seconds: number
  setMode: (mode: FlashMode) => void
  setSeconds: (seconds: number) => void
}

export const useFlashPrefsStore = create<FlashPrefs>()(
  persist((set) => ({ mode: 'banner', seconds: FLASH_SECONDS.default, setMode: (mode) => set({ mode }), setSeconds: (seconds) => set({ seconds }) }), {
    name: 'stageboard-flash-prefs',
    version: 1,
    // Version 0 had `enabled: boolean` (on = the full-screen overlay of the first version).
    migrate: (persisted) => {
      const old = persisted as { enabled?: boolean } | undefined
      return { mode: old?.enabled === false ? 'off' : 'banner', seconds: FLASH_SECONDS.default } as FlashPrefs
    },
  }),
)

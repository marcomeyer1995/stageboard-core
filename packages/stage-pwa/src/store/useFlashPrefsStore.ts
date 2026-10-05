import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FlashPrefs {
  /** Show Stage-Messenger flash messages and song alerts on this device (#26). */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useFlashPrefsStore = create<FlashPrefs>()(
  persist((set) => ({ enabled: true, setEnabled: (enabled) => set({ enabled }) }), { name: 'stageboard-flash-prefs' }),
)

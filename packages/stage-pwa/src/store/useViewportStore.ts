import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ViewportState {
  /** Whether this device wants fullscreen - set by actually using the fullscreen button. */
  preferFullscreen: boolean
  setPreferFullscreen: (preferFullscreen: boolean) => void
}

/**
 * Per-device viewport preference. Deliberately not synced: whether a tablet is clamped
 * to the front of a mic stand or lying on a keyboard is a property of the device, not
 * of the band.
 */
export const useViewportStore = create<ViewportState>()(
  persist(
    (set) => ({
      preferFullscreen: false,
      setPreferFullscreen: (preferFullscreen) => set({ preferFullscreen }),
    }),
    { name: 'stageboard-viewport' },
  ),
)

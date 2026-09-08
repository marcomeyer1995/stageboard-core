import { create } from 'zustand'

export interface NewDevicePrefill {
  name: string
  pluginId: string
  capability: string | null
}

interface HardwareSetupWizardState {
  prefill: NewDevicePrefill | null
  requestNewDevice: (prefill: NewDevicePrefill) => void
  consumePrefill: () => void
}

/**
 * Cross-cutting command channel, same reasoning as useActiveSystemTabStore.ts: useHardwareDetection
 * .ts's "no matching role yet" dialog fires from a WebMIDI event handler, nowhere near
 * HardwareSetupManager.tsx's own component tree, so it has no direct way to open
 * DeviceSetupWizard.tsx pre-filled with what was just detected - it can only set this and let
 * HardwareSetupManager.tsx (the sole reader) react. `requestNewDevice` is safe to call more than
 * once before it's consumed (the newest detected device simply wins, same as any other
 * last-write-wins Zustand field).
 */
export const useHardwareSetupWizardStore = create<HardwareSetupWizardState>((set) => ({
  prefill: null,
  requestNewDevice: (prefill) => set({ prefill }),
  consumePrefill: () => set({ prefill: null }),
}))

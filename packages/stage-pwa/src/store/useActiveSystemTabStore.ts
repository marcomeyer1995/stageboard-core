import { create } from 'zustand'

export type SystemTab = 'band' | 'plugins' | 'hardware' | 'devices' | 'backup' | 'post-show' | 'settings'

interface ActiveSystemTabState {
  /** `null` whenever `SystemView.tsx` isn't mounted at all (Live/Bibliothek showing, or the
   * app hasn't loaded yet) - not just "which tab was last open." */
  activeTab: SystemTab | null
  setActiveTab: (tab: SystemTab | null) => void
}

/**
 * Which `SystemView.tsx` tab is currently on screen, if any - lifted out of that component's own
 * local state (2026-09-08, Marco's explicit request/safety concern) so `useHardwareDetection.ts`
 * can gate its "Neues Gerät: X - welche Rolle?" prompt on "is System → Hardware actually visible
 * right now," without prop-drilling through App.tsx. `SystemView.tsx` is the sole writer (synced
 * on every tab change, cleared to `null` on unmount); everything else only ever reads it.
 */
export const useActiveSystemTabStore = create<ActiveSystemTabState>((set) => ({
  activeTab: null,
  setActiveTab: (activeTab) => set({ activeTab }),
}))

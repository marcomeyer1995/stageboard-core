import { create } from 'zustand'

interface ReadyCheckStore {
  /** The check this device already dealt with - answered, or (for a device that cannot answer)
   * dismissed - so its overlay stays away for the rest of that check. */
  handledCheckId: string | null
  markHandled: (checkId: string) => void
}

/** Purely local and volatile: a reload while a check is still open simply shows the overlay
 * again, which is the safe direction. */
export const useReadyCheckStore = create<ReadyCheckStore>((set) => ({
  handledCheckId: null,
  markHandled: (checkId) => set({ handledCheckId: checkId }),
}))

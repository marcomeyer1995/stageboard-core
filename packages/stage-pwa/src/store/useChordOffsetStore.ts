import { create } from 'zustand'

interface ChordOffsetStore {
  /** The queue entry the offsets below were set for - they only count while that entry is
   * still current, which is what makes them reset on a song change without any effect. */
  entryId: string | null
  transposeOffset: number
  capoOffset: number
  setTranspose: (entryId: string, offset: number) => void
  setCapo: (entryId: string, offset: number) => void
  reset: () => void
}

/**
 * This device's own for-tonight chord shifts (#59): transposing for a singer and placing a capo
 * change what THIS player reads, not what the band plays, so - unlike the Master-gated
 * ShowState overrides - nothing here syncs. Deliberately neither persisted: a -2 for one song
 * must never silently carry into the next or the next gig.
 */
export const useChordOffsetStore = create<ChordOffsetStore>((set, get) => ({
  entryId: null,
  transposeOffset: 0,
  capoOffset: 0,
  // Touching a different entry than the stored one starts from a clean slate for the other axis.
  setTranspose: (entryId, transposeOffset) =>
    set({ entryId, transposeOffset, capoOffset: get().entryId === entryId ? get().capoOffset : 0 }),
  setCapo: (entryId, capoOffset) =>
    set({ entryId, capoOffset, transposeOffset: get().entryId === entryId ? get().transposeOffset : 0 }),
  reset: () => set({ entryId: null, transposeOffset: 0, capoOffset: 0 }),
}))

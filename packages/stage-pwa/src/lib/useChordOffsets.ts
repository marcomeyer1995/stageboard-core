import { useChordOffsetStore } from '../store/useChordOffsetStore'

/** Highest shift either stepper allows - a full octave in each direction is already the whole
 * range (12 semitones wrap), and a capo above the 11th fret is not playable anyway. */
export const MAX_TRANSPOSE = 11
export const MAX_CAPO_FRET = 11

export interface ChordOffsets {
  transposeOffset: number
  /** Extra frets on top of the variant's own authored capo (its chords are already written for that one). */
  capoOffset: number
  /** The capo fret the player actually uses: authored + session offset. */
  effectiveCapo: number
  /** Semitones to shift the WRITTEN chords by: transpose, minus the extra capo frets. */
  chordShift: number
  stepTranspose: (delta: number) => void
  stepCapo: (delta: number) => void
  reset: () => void
}

/** The session offsets for the current queue entry (0/0 when none were set for it) plus the
 * derived values every consumer needs - see useChordOffsetStore for why they reset by entry. */
export function useChordOffsets(entryId: string | null, authoredCapo = 0): ChordOffsets {
  const stored = useChordOffsetStore((state) => state)
  const forThisEntry = entryId !== null && stored.entryId === entryId
  const transposeOffset = forThisEntry ? stored.transposeOffset : 0
  const capoOffset = forThisEntry ? stored.capoOffset : 0

  return {
    transposeOffset,
    capoOffset,
    effectiveCapo: authoredCapo + capoOffset,
    chordShift: transposeOffset - capoOffset,
    stepTranspose: (delta) => {
      if (entryId === null) return
      const next = Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, transposeOffset + delta))
      stored.setTranspose(entryId, next)
    },
    stepCapo: (delta) => {
      if (entryId === null) return
      const next = Math.max(-authoredCapo, Math.min(MAX_CAPO_FRET - authoredCapo, capoOffset + delta))
      stored.setCapo(entryId, next)
    },
    reset: stored.reset,
  }
}

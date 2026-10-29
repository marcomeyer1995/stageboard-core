import { get as getChordByName } from '@tonaljs/chord'
import { CHORD_QUALITIES, noteToPitchClass, type ChordQualityId } from './chordReference'

export interface ChordSymbolInfo {
  /** The symbol as written on the sheet (`F#m7/C#`). */
  symbol: string
  rootPitchClass: number
  /** Note names in chord order, spelled by tonal (`F# A C# E`). */
  notes: string[]
  /** Semitones above the root, ascending - what the piano diagram lights. */
  semitones: number[]
  /** The bass of a slash chord (`C#`), if any. */
  bass: string | null
  /** Set when the chord's type is one the guitar shape table knows (lib/guitarShapes.ts). */
  qualityId: ChordQualityId | null
}

/**
 * Reads a chord as it stands on the sheet (#609) for the chord popover - any symbol tonal knows,
 * so `C9` or `F#m7b5` still get their notes and piano keys; the guitar shape only exists for the
 * qualities of the chord reference. German `H` reads as B. Null for anything that isn't a chord
 * (`N.C.`, a typo).
 */
export function parseChordSymbol(symbol: string): ChordSymbolInfo | null {
  const trimmed = symbol.trim()
  const [main, bassPart] = trimmed.split('/')
  const name = main.replace(/^H(?=[#b]?)/, 'B')
  const chord = getChordByName(name)
  if (chord.empty || !chord.tonic) return null
  const rootPitchClass = noteToPitchClass(chord.tonic)
  const semitones = chord.notes.reduce<number[]>((stack, note) => {
    const previous = stack[stack.length - 1]
    if (previous === undefined) return [0]
    let next = (noteToPitchClass(note) - rootPitchClass + 12) % 12
    while (next <= previous) next += 12
    return [...stack, next]
  }, [])
  const quality = CHORD_QUALITIES.find((candidate) => candidate.tonalType === chord.type)
  const bass = bassPart?.trim().replace(/^H/, 'B') || null
  return { symbol: trimmed, rootPitchClass, notes: chord.notes, semitones, bass, qualityId: quality?.id ?? null }
}

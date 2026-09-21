import { getChord } from '@tonaljs/chord'

export type NoteNaming = 'sharp' | 'flat'

const SHARP_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const FLAT_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

/** The twelve pitch classes, 0 = C, spelled as the musician prefers (F# or Gb). */
export function rootName(pitchClass: number, naming: NoteNaming): string {
  return (naming === 'flat' ? FLAT_ROOTS : SHARP_ROOTS)[((pitchClass % 12) + 12) % 12]
}

export type ChordQualityId = 'maj' | 'min' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4' | 'dim' | 'aug' | '6' | '5'

export interface ChordQuality {
  id: ChordQualityId
  /** Label on the selector. */
  label: string
  /** What follows the root in the chord symbol (`C` + `maj7`). */
  symbol: string
  /** Chord type name understood by @tonaljs/chord's `getChord`. */
  tonalType: string
}

/** The qualities worth a quick lookup on stage, in the order the selector shows them. */
export const CHORD_QUALITIES: readonly ChordQuality[] = [
  { id: 'maj', label: 'Dur', symbol: '', tonalType: 'major' },
  { id: 'min', label: 'Moll', symbol: 'm', tonalType: 'minor' },
  { id: '7', label: '7', symbol: '7', tonalType: 'dominant seventh' },
  { id: 'maj7', label: 'maj7', symbol: 'maj7', tonalType: 'major seventh' },
  { id: 'm7', label: 'm7', symbol: 'm7', tonalType: 'minor seventh' },
  { id: 'sus2', label: 'sus2', symbol: 'sus2', tonalType: 'suspended second' },
  { id: 'sus4', label: 'sus4', symbol: 'sus4', tonalType: 'suspended fourth' },
  { id: 'dim', label: 'dim', symbol: 'dim', tonalType: 'diminished' },
  { id: 'aug', label: 'aug', symbol: 'aug', tonalType: 'augmented' },
  { id: '6', label: '6', symbol: '6', tonalType: 'sixth' },
  { id: '5', label: '5', symbol: '5', tonalType: 'fifth' },
]

export interface ChordInfo {
  /** `Cmaj7`. */
  symbol: string
  /** Note names in chord order, spelled by tonal from the chosen root (`Bb D F A`). */
  notes: string[]
  /** Interval numbers over the root, as a musician reads them: `1 b3 5 b7`. */
  intervals: string[]
  /** Absolute pitch classes (0 = C, 11 = B) of the chord tones, in chord order. */
  pitchClasses: number[]
  /** Semitones above the root, ascending, one octave-stack (`[0, 4, 7, 11]`) - what a keyboard shows. */
  semitones: number[]
}

/** Tonal's interval names (`3M`, `7m`, `5d`) as chord-chart numbers (`3`, `b7`, `b5`). */
function intervalLabel(tonalInterval: string): string {
  const match = /^(\d+)([PMmAd]+)$/.exec(tonalInterval)
  if (!match) return tonalInterval
  const [, number, quality] = match
  if (quality === 'm' || quality === 'd') return `b${number}`
  if (quality === 'A') return `#${number}`
  return number
}

/** Looks a chord up. `rootPitchClass` 0-11 plus the quality; the root is spelled per `naming`. */
export function lookUpChord(rootPitchClass: number, qualityId: ChordQualityId, naming: NoteNaming): ChordInfo {
  const quality = CHORD_QUALITIES.find((candidate) => candidate.id === qualityId) ?? CHORD_QUALITIES[0]
  const root = rootName(rootPitchClass, naming)
  const chord = getChord(quality.tonalType, root)
  const pitchClasses = chord.notes.map((note) => noteToPitchClass(note))
  const rootIndex = ((rootPitchClass % 12) + 12) % 12
  // Ascending stack from the root: each next note is the next pitch class above the previous one.
  const semitones = pitchClasses.reduce<number[]>((stack, pitchClass) => {
    const previous = stack[stack.length - 1]
    if (previous === undefined) return [0]
    let next = (pitchClass - rootIndex + 12) % 12
    while (next <= previous) next += 12
    return [...stack, next]
  }, [])
  return {
    symbol: root + quality.symbol,
    notes: chord.notes,
    intervals: chord.intervals.map(intervalLabel),
    pitchClasses,
    semitones,
  }
}

const NATURAL_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** `Bb` -> 10, `F#` -> 6, `Cb` -> 11 (also double accidentals, which tonal can spell for dim/aug). */
export function noteToPitchClass(note: string): number {
  const letter = NATURAL_PITCH_CLASS[note[0]]
  const shift = [...note.slice(1)].reduce((sum, accidental) => sum + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0), 0)
  return (((letter + shift) % 12) + 12) % 12
}

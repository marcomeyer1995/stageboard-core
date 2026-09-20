import type { ChordProLine } from './chordpro'

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const
const NATURAL_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Pitch classes whose key is conventionally spelled with flats (F, Bb, Eb, Ab, Db, Gb major;
 * Dm, Gm, Cm, Fm, Bbm, Ebm minor). Everything else is spelled with sharps. */
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1, 6])
const FLAT_MINOR_KEYS = new Set([2, 7, 0, 5, 10, 3])

const NOTE_RE = /^([A-G])([#b♯♭]?)(.*)$/

function noteIndex(letter: string, accidental: string): number {
  const shift = accidental === '#' || accidental === '♯' ? 1 : accidental === 'b' || accidental === '♭' ? -1 : 0
  return (NATURAL_INDEX[letter] + shift + 12) % 12
}

function modulo12(value: number): number {
  return ((value % 12) + 12) % 12
}

function spell(index: number, useFlats: boolean): string {
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[modulo12(index)]
}

/** A "Xm..." suffix (but not "maj") marks a minor key/chord. */
function isMinorSuffix(suffix: string): boolean {
  return /^m(?!aj)/i.test(suffix) && !suffix.startsWith('M')
}

/**
 * Whether to spell accidentals as flats for a song in `key` shifted by `semitones`. A key that
 * shifts to F/Bb/Eb/... reads with flats, the rest with sharps; without a known key the
 * direction of the shift decides (down = flats), so a plain "-1" still looks natural.
 */
export function prefersFlats(key: string | undefined, semitones: number): boolean {
  const match = key ? NOTE_RE.exec(key.trim()) : null
  if (!match) return semitones < 0
  const target = modulo12(noteIndex(match[1], match[2]) + semitones)
  return (isMinorSuffix(match[3]) ? FLAT_MINOR_KEYS : FLAT_MAJOR_KEYS).has(target)
}

/** Shifts one chord symbol (root, suffix and an optional `/bass`). Anything that isn't a note
 * name - `N.C.`, `x`, a stray annotation - is returned untouched rather than mangled. */
export function transposeChord(chord: string, semitones: number, useFlats: boolean): string {
  if (modulo12(semitones) === 0) return chord
  const [root, bass, ...extra] = chord.split('/')
  const rootMatch = NOTE_RE.exec(root)
  if (!rootMatch || extra.length > 0) return chord

  const shiftedRoot = spell(noteIndex(rootMatch[1], rootMatch[2]) + semitones, useFlats) + rootMatch[3]
  if (bass === undefined) return shiftedRoot
  const bassMatch = /^([A-G])([#b♯♭]?)$/.exec(bass)
  if (!bassMatch) return chord
  return `${shiftedRoot}/${spell(noteIndex(bassMatch[1], bassMatch[2]) + semitones, useFlats)}`
}

/** The song's key after shifting, spelled for its own new key (`G` -1 -> `Gb`). */
export function transposeKey(key: string, semitones: number): string {
  const match = NOTE_RE.exec(key.trim())
  if (!match) return key
  const shiftedIndex = noteIndex(match[1], match[2]) + semitones
  const useFlats = prefersFlats(key, semitones)
  return spell(shiftedIndex, useFlats) + match[3]
}

/**
 * The chords the player reads: written chord + `semitones`. Lyrics, comments and part labels
 * are untouched, so every line keeps its index (pagination and the scroll position rely on
 * that). A shift of 0 returns the very same array.
 */
export function transposeLines(lines: ChordProLine[], semitones: number, key: string | undefined): ChordProLine[] {
  if (modulo12(semitones) === 0) return lines
  const useFlats = prefersFlats(key, semitones)
  return lines.map((line) => ({
    ...line,
    segments: line.segments.map((segment) =>
      segment.chord === null ? segment : { ...segment, chord: transposeChord(segment.chord, semitones, useFlats) },
    ),
  }))
}

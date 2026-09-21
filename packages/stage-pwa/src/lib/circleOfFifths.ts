import type { NoteNaming } from './chordReference'

export type CircleRing = 'major' | 'minor'

/** One slice of the wheel: which ring, and its position clockwise from the top (0 = C / Am). */
export interface CircleKey {
  ring: CircleRing
  index: number
}

const MAJOR_SHARP = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'] as const
const MAJOR_FLAT = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'] as const
/** The relative minors: the same slice on the inner ring, three semitones below the major. */
const MINOR_SHARP = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F', 'C', 'G', 'D'] as const
const MINOR_FLAT = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'] as const

function wrap(index: number): number {
  return ((index % 12) + 12) % 12
}

/** `C`, `F#`, `Am`, `Ebm` - the label on the wheel and in the readout. `naming` only matters where
 * a slice has two spellings (the F#/Gb slice and the ones next to it). */
export function circleLabel(key: CircleKey, naming: NoteNaming): string {
  if (key.ring === 'major') return (naming === 'flat' ? MAJOR_FLAT : MAJOR_SHARP)[wrap(key.index)]
  return `${(naming === 'flat' ? MINOR_FLAT : MINOR_SHARP)[wrap(key.index)]}m`
}

export interface KeyRelations {
  selected: CircleKey
  /** Paralleltonart: the relative major/minor sharing the key signature (C major <-> A minor). */
  relative: CircleKey
  /** Dominante: one step clockwise, a fifth up. */
  dominant: CircleKey
  /** Subdominante: one step counter-clockwise, a fifth down. */
  subdominant: CircleKey
}

export function keyRelations(selected: CircleKey): KeyRelations {
  const index = wrap(selected.index)
  return {
    selected: { ring: selected.ring, index },
    relative: { ring: selected.ring === 'major' ? 'minor' : 'major', index },
    dominant: { ring: selected.ring, index: wrap(index + 1) },
    subdominant: { ring: selected.ring, index: wrap(index - 1) },
  }
}

/** Sharps (positive) or flats (negative) in the key signature. The three slices at the bottom
 * are enharmonic, so they are given with the sharp count. */
export function signatureAccidentals(index: number, naming: NoteNaming): number {
  const position = wrap(index)
  if (position < 6) return position
  // From the bottom of the wheel on, the same slices can be read either way: F#/Gb is 6 sharps or
  // 6 flats, C#/Db 7 sharps or 5 flats, and on to Ab 4, Eb 3, Bb 2, F 1 flat.
  return naming === 'sharp' ? position : position - 12
}

/** `keine Vorzeichen`, `1 ♯`, `3 ♭`. */
export function describeSignature(index: number, naming: NoteNaming): string {
  const count = signatureAccidentals(index, naming)
  if (count === 0) return 'keine Vorzeichen'
  return `${Math.abs(count)} ${count > 0 ? '♯' : '♭'}`
}

/** SVG path of one ring segment (donut slice), `index` clockwise from 12 o'clock. */
export function wedgePath(cx: number, cy: number, innerRadius: number, outerRadius: number, index: number): string {
  const start = ((index - 0.5) * Math.PI) / 6 - Math.PI / 2
  const end = start + Math.PI / 6
  const point = (radius: number, angle: number) => `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`
  return [
    `M ${point(outerRadius, start)}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${point(outerRadius, end)}`,
    `L ${point(innerRadius, end)}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${point(innerRadius, start)}`,
    'Z',
  ].join(' ')
}

/** The centre of a slice - where its label goes. */
export function wedgeCentre(cx: number, cy: number, radius: number, index: number): { x: number; y: number } {
  const angle = (index * Math.PI) / 6 - Math.PI / 2
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
}

/** `C-Dur`, `A-Moll` - a slice as a key name. */
export function keyName(key: CircleKey, naming: NoteNaming): string {
  const label = circleLabel(key, naming)
  return key.ring === 'major' ? `${label}-Dur` : `${label.slice(0, -1)}-Moll`
}

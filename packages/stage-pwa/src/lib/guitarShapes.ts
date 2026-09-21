import type { ChordQualityId } from './chordReference'

/** Fret per string, low E to high e. `null` = muted, 0 = open. */
export type Frets = readonly (number | null)[]

export interface GuitarShape {
  frets: Frets
  /** First fret of the diagram window: 1 shows the nut, higher numbers a labelled position. */
  baseFret: number
}

/** Standard tuning E A D G B E, as MIDI note numbers (E2 = 40). */
export const STRING_MIDI = [40, 45, 50, 55, 59, 64] as const

/** Movable barre forms as fret offsets from the root fret `r` (`null` stays muted). The E-form's
 * root is on the 6th string (E), the A-form's on the 5th (A). */
const E_FORM: Partial<Record<ChordQualityId, Frets>> = {
  maj: [0, 2, 2, 1, 0, 0],
  min: [0, 2, 2, 0, 0, 0],
  '7': [0, 2, 0, 1, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  aug: [0, 3, 2, 1, 1, 0],
  '6': [0, 2, 2, 1, 2, 0],
  '5': [0, 2, 2, null, null, null],
}
const A_FORM: Partial<Record<ChordQualityId, Frets>> = {
  maj: [null, 0, 2, 2, 2, 0],
  min: [null, 0, 2, 2, 1, 0],
  '7': [null, 0, 2, 0, 2, 0],
  maj7: [null, 0, 2, 1, 2, 0],
  m7: [null, 0, 2, 0, 1, 0],
  sus2: [null, 0, 2, 2, 0, 0],
  sus4: [null, 0, 2, 2, 3, 0],
  dim: [null, 0, 1, 2, 1, null],
  aug: [null, 0, 3, 2, 2, 1],
  '6': [null, 0, 2, 2, 2, 2],
}

/** The familiar first-position shapes for the roots where the open shape differs from the
 * movable one (C, D, G) plus the E chord's sus2. Keyed `pitchClass:quality`. */
const OPEN_SHAPES: Record<string, Frets> = {
  '0:maj': [null, 3, 2, 0, 1, 0],
  '0:7': [null, 3, 2, 3, 1, 0],
  '0:maj7': [null, 3, 2, 0, 0, 0],
  '0:sus2': [null, 3, 0, 0, 1, 3],
  '0:sus4': [null, 3, 3, 0, 1, 1],
  '0:6': [null, 3, 2, 2, 1, 0],
  '2:maj': [null, null, 0, 2, 3, 2],
  '2:min': [null, null, 0, 2, 3, 1],
  '2:7': [null, null, 0, 2, 1, 2],
  '2:maj7': [null, null, 0, 2, 2, 2],
  '2:m7': [null, null, 0, 2, 1, 1],
  '2:sus2': [null, null, 0, 2, 3, 0],
  '2:sus4': [null, null, 0, 2, 3, 3],
  '2:6': [null, null, 0, 2, 0, 2],
  '4:sus2': [0, 2, 4, 4, 0, 0],
  '7:maj': [3, 2, 0, 0, 0, 3],
  '7:7': [3, 2, 0, 0, 0, 1],
  '7:maj7': [3, 2, 0, 0, 0, 2],
  '7:sus2': [3, 0, 0, 0, 3, 3],
  '7:sus4': [3, 3, 0, 0, 1, 3],
}

const E_ROOT_PITCH_CLASS = 4
const A_ROOT_PITCH_CLASS = 9
const HIGHEST_FRET = 15

function place(form: Frets, rootFret: number): Frets {
  return form.map((fret) => (fret === null ? null : fret + rootFret))
}

/**
 * A guitar shape for `qualityId` on `pitchClass` (0 = C), in standard tuning - a curated open shape
 * where there is a familiar one, otherwise the E-form or A-form barre chord, whichever sits lower
 * on the neck. Null only if no shape fits the neck (none of the supported combinations).
 */
export function guitarShapeFor(pitchClass: number, qualityId: ChordQualityId): GuitarShape | null {
  const root = ((pitchClass % 12) + 12) % 12
  const open = OPEN_SHAPES[`${root}:${qualityId}`]
  if (open) return withWindow(open)

  const candidates: Frets[] = []
  const eForm = E_FORM[qualityId]
  const aForm = A_FORM[qualityId]
  if (eForm) candidates.push(place(eForm, (root - E_ROOT_PITCH_CLASS + 12) % 12))
  if (aForm) candidates.push(place(aForm, (root - A_ROOT_PITCH_CLASS + 12) % 12))
  const playable = candidates
    .filter((frets) => frets.every((fret) => fret === null || (fret >= 0 && fret <= HIGHEST_FRET)))
    .sort((a, b) => rootFretOf(a) - rootFretOf(b))
  return playable.length > 0 ? withWindow(playable[0]) : null
}

function rootFretOf(frets: Frets): number {
  // The lowest fret in use: how far up the neck the shape sits.
  return Math.min(...frets.filter((fret): fret is number => fret !== null))
}

function withWindow(frets: Frets): GuitarShape {
  const fretted = frets.filter((fret): fret is number => fret !== null && fret > 0)
  const highest = fretted.length > 0 ? Math.max(...fretted) : 0
  // Fits the first four frets: show the nut. Otherwise start the window at the lowest fretted
  // note and label that position.
  const baseFret = highest <= 4 ? 1 : Math.min(...fretted)
  return { frets, baseFret }
}

/** The pitch classes a shape actually sounds, string by string (muted strings skipped). */
export function soundedPitchClasses(frets: Frets): number[] {
  return frets.flatMap((fret, string) => (fret === null ? [] : [(STRING_MIDI[string] + fret) % 12]))
}

/** The lowest sounded pitch class (the bass note). */
export function bassPitchClass(frets: Frets): number | null {
  const string = frets.findIndex((fret) => fret !== null)
  return string === -1 ? null : (STRING_MIDI[string] + (frets[string] ?? 0)) % 12
}

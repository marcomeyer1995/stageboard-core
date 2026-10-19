import type { OpenTuning, SongVariant, Tuning } from 'shared-types'
import { transposeKey } from './transposeChord'

/**
 * Tuning and stored transpose (Marco, 2026-10-18). Transpose is how a variant sounds compared with
 * the original recording; the played tuning ("Stimmung") is how far the instruments are tuned from
 * standard; the chart tuning ("Akkorde notiert für") is what the written chords assume. The grips:
 * transpose - played + chart. A guitar tuned a half step down (-1) playing a song two lower (-2)
 * grabs one lower (-1); the same guitar at 0 grabs one higher (+1) to sound like the original -
 * unless the chart is itself written for Eb (then the written chords). Drop and open tunings don't
 * move the chords - only `semitones` does.
 */

export const STANDARD_TUNING: Tuning = { semitones: 0 }

type VariantTuningFields = Pick<SongVariant, 'tuningSpec' | 'chartTuning' | 'tuning'>

/** How this variant is played: its Stimmung, else standard - per song, never band-wide (Marco,
 * 2026-10-18: it depends on which guitar is taken). */
export function playTuning(variant: Partial<VariantTuningFields> | null | undefined): Tuning {
  return variant?.tuningSpec ?? STANDARD_TUNING
}

/** What the chart is written for: the guided field, else the old free text if it can be read. */
export function chartTuning(variant: Partial<VariantTuningFields> | null | undefined): Tuning {
  if (variant?.chartTuning) return variant.chartTuning
  return (variant?.tuning ? parseTuning(variant.tuning) : null) ?? STANDARD_TUNING
}

/** Old free text that can't be read as a tuning - shown as it is, so nothing gets lost silently. */
export function unrecognisedTuningText(variant: Partial<VariantTuningFields> | null | undefined): string | null {
  if (!variant?.tuning || variant.chartTuning) return null
  return parseTuning(variant.tuning) ? null : variant.tuning.trim() || null
}

/** How to tune for this variant on stage: the played offset, with the chart's Drop / open tuning
 * when the played one names none - the written shapes only work in that string layout (a guitar in
 * Eb playing a Drop D chart tunes Drop C#). */
export function stageTuning(variant: Partial<VariantTuningFields> | null | undefined): Tuning {
  const played = playTuning(variant)
  if (played.drop || played.open) return played
  const chart = chartTuning(variant)
  if (chart.open) return { semitones: played.semitones, open: chart.open }
  if (chart.drop) return { semitones: played.semitones, drop: true }
  return played
}

/** Half steps to shift the written chords by, for every player of this variant. */
export function variantChordShift(
  variant: (Partial<VariantTuningFields> & Pick<SongVariant, 'transpose'>) | null | undefined,
): number {
  return (variant?.transpose ?? 0) - playTuning(variant).semitones + chartTuning(variant).semitones
}

/** The key the song sounds in - the written key moved by the stored transpose. */
export function soundingKey(variant: Pick<SongVariant, 'key' | 'transpose'> | null | undefined): string | undefined {
  if (!variant?.key) return undefined
  return transposeKey(variant.key, variant.transpose ?? 0)
}

/** "+2" / "−1" / "0" - signed half steps for labels. */
export function signedSteps(steps: number): string {
  return steps > 0 ? `+${steps}` : steps < 0 ? `−${-steps}` : '0'
}

export function isStandard(tuning: Tuning): boolean {
  return tuning.semitones === 0 && !tuning.drop && !tuning.open
}

const OPEN_NAMES: Record<OpenTuning, string> = { dadgad: 'DADGAD', 'open-g': 'Open G', 'open-d': 'Open D', 'open-e': 'Open E' }

function offsetLabel(semitones: number): string {
  const n = Math.abs(semitones)
  const amount = n === 1 ? '½ Ton' : n === 2 ? '1 Ton' : `${n} Halbtöne`
  return `${amount} ${semitones < 0 ? 'tiefer' : 'höher'}`
}

/** How a tuning reads: "Standard", "½ Ton tiefer (Eb)", "Drop D", "Drop C#", "Open G ½ Ton tiefer". */
export function tuningLabel(tuning: Tuning): string {
  const { semitones } = tuning
  if (tuning.open) return semitones === 0 ? OPEN_NAMES[tuning.open] : `${OPEN_NAMES[tuning.open]} ${offsetLabel(semitones)}`
  if (tuning.drop) return `Drop ${spellSharp(2 + semitones)}`
  if (semitones === 0) return 'Standard'
  return `${offsetLabel(semitones)} (${transposeKey('E', semitones)})`
}

// --- Reading the old free text and imports ("Eb Ab Db Gb Bb Eb", "Half step down", "Drop D") ---

const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const STANDARD_PCS = [4, 9, 2, 7, 11, 4]
const OPEN_PCS: Record<OpenTuning, number[]> = {
  dadgad: [2, 9, 2, 7, 9, 2],
  'open-g': [2, 7, 2, 7, 11, 2],
  'open-d': [2, 9, 2, 6, 9, 2],
  'open-e': [4, 11, 4, 8, 11, 4],
}

function spellSharp(pc: number): string {
  return ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'][((pc % 12) + 12) % 12]!
}

/** A pitch-class difference as the nearest step: 11 -> -1, 6 -> -6. */
function signedDiff(diff: number): number {
  const d = ((diff % 12) + 12) % 12
  return d > 6 ? d - 12 : d
}

function notePc(letter: string, accidental: string | undefined): number {
  const base = NOTE_PC[letter.toLowerCase()]!
  const acc = accidental?.toLowerCase()
  return base + (acc === '#' || acc === '♯' || acc === 'sharp' ? 1 : acc === 'b' || acc === '♭' || acc === 'flat' ? -1 : 0)
}

/** Six notes, low string first - spaced ("Eb Ab Db Gb Bb Eb") or run together ("DADGAD", "EADGBe"). */
function readNotes(text: string): number[] | null {
  const spaced = text.trim().split(/[\s,-]+/)
  if (spaced.length === 6 && spaced.every((t) => /^[A-Ga-g][#b♯♭]?$/.test(t))) {
    return spaced.map((t) => notePc(t[0]!, t.slice(1) || undefined))
  }
  const compact = text.replace(/\s/g, '')
  for (const re of [/[A-Ga-g][#♯♭b]?/g, /[A-Ga-g][#♯]?/g]) {
    const tokens = compact.match(re)
    if (tokens && tokens.length === 6 && tokens.join('') === compact) return tokens.map((t) => notePc(t[0]!, t.slice(1) || undefined))
  }
  return null
}

function fromNotes(pcs: number[]): Tuning | null {
  const diffs = pcs.map((pc, i) => signedDiff(pc - STANDARD_PCS[i]!))
  const upper = diffs.slice(1)
  if (upper.every((d) => d === upper[0])) {
    const k = upper[0]!
    if (diffs[0] === k) return { semitones: k }
    if (signedDiff(diffs[0]! - k) === -2) return { semitones: k, drop: true }
  }
  // Open E is Open D a whole step up - an exact match first, then one shifted.
  const opens = Object.entries(OPEN_PCS) as [OpenTuning, number[]][]
  const shifted = opens.flatMap(([open, openPcs]) => {
    const offs = pcs.map((pc, i) => signedDiff(pc - openPcs[i]!))
    return offs.every((d) => d === offs[0]) ? [{ semitones: offs[0]!, open }] : []
  })
  return shifted.find((tuning) => tuning.semitones === 0) ?? shifted[0] ?? null
}

/** The tuning a free text names, or null when it can't be read. */
export function parseTuning(text: string): Tuning | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t || /^(e ?)?standard( ?\(?e ?a ?d ?g ?b ?e\)?)?$/.test(t)) return { semitones: 0 }
  if (/dadgad/.test(t)) return { semitones: 0, open: 'dadgad' }
  const open = /open ?([gde])\b/.exec(t)
  if (open) return { semitones: 0, open: `open-${open[1]}` as OpenTuning }
  const drop = /drop ?([a-g])( ?(#|♯|b|♭|sharp|flat))?(?![a-z])/.exec(t)
  if (drop) return { semitones: signedDiff(notePc(drop[1]!, drop[3]) - 2), drop: true }
  if (/half[ -]?step down|1\/2 step down|½ ?(step|ton)? ?(down|tiefer)|e ?(b|♭|flat) standard/.test(t)) return { semitones: -1 }
  if (/(whole|full)[ -]?step down|1 step down|ganzton tiefer|1 ton tiefer/.test(t)) return { semitones: -2 }
  const named = /^([a-g])( ?(#|♯|b|♭|sharp|flat))? ?standard$/.exec(t)
  if (named) return { semitones: signedDiff(notePc(named[1]!, named[3]) - 4) }
  const notes = readNotes(text)
  return notes ? fromNotes(notes) : null
}

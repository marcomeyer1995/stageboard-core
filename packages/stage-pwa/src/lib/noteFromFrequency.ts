const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const A4_MIDI_NUMBER = 69
const DEFAULT_REFERENCE_FREQUENCY = 440

export interface NoteMatch {
  name: string
  octave: number
  /** Deviation from the exact pitch, in cents. -50..50 by construction (nearest semitone). */
  cents: number
}

export interface NoteFromFrequencyOptions {
  /** A4's frequency in Hz - the tuning standard everything else is measured against.
   * 440 by default, but bands using a different reference (e.g. 442/443 orchestral
   * sharp, 415 baroque) need this adjustable rather than hardcoded. */
  referenceFrequency?: number
  /** Whether an out-of-key note like the one between F and G is spelled F# or Gb. */
  naming?: 'sharp' | 'flat'
}

/** Equal temperament, referenced against `referenceFrequency` (default A4 = 440 Hz). */
export function noteFromFrequency(
  frequency: number,
  { referenceFrequency = DEFAULT_REFERENCE_FREQUENCY, naming = 'sharp' }: NoteFromFrequencyOptions = {},
): NoteMatch {
  const midiNumber = A4_MIDI_NUMBER + 12 * Math.log2(frequency / referenceFrequency)
  const rounded = Math.round(midiNumber)
  const cents = Math.round((midiNumber - rounded) * 100)
  const names = naming === 'flat' ? FLAT_NAMES : SHARP_NAMES
  const name = names[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return { name, octave, cents }
}

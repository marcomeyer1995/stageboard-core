const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const A4_FREQUENCY = 440
const A4_MIDI_NUMBER = 69

export interface NoteMatch {
  name: string
  octave: number
  /** Deviation from the exact pitch, in cents. -50..50 by construction (nearest semitone). */
  cents: number
}

/** Equal temperament, A4 = 440 Hz. */
export function noteFromFrequency(frequency: number): NoteMatch {
  const midiNumber = A4_MIDI_NUMBER + 12 * Math.log2(frequency / A4_FREQUENCY)
  const rounded = Math.round(midiNumber)
  const cents = Math.round((midiNumber - rounded) * 100)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12]
  const octave = Math.floor(rounded / 12) - 1
  return { name, octave, cents }
}

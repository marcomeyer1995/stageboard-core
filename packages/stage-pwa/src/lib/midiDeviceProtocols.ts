/**
 * The MIDI vocabulary of the devices StageBoard talks to over WebMIDI, in one store-free module:
 * the translators (kemperTranslator.ts, mg30Translator.ts, rc500Translator.ts) SEND with it, and
 * the Cue Recorder's decoders (midiCueDecoders.ts) READ with it - one table, so what a translator
 * can fire and what the recorder can capture never drift apart. Kept free of any store import so
 * decoders stay unit-testable without workspaceDb.ts's top-level `new PouchDB(...)`.
 */

/** Own dedicated capabilities, not among `capability.ts`'s core `CAPABILITIES` (a device-specific
 * plugin brings its own - see each translator's doc comment). */
export const KEMPER_CAPABILITY = 'kemper-control'
export const MG30_CAPABILITY = 'mg30-control'
export const RC500_CAPABILITY = 'rc500-control'

/** The Kemper Profiler's "Table 1" plain MIDI CC layer (kemper-profiler-midi-parameter-
 * documentation.pdf, also `~/Device Emulators/Kemper Emulator/kemper_emulator/cc_map.py`) - the
 * NRPN/SysEx layers (continuous parameters, rig renaming) aren't implemented yet. */
export const KEMPER_CC = {
  performancePreselect: 47,
  slot: [50, 51, 52, 53, 54], // index 0 = slot 1 ... index 4 = slot 5
  tuner: 31,
} as const

export const KEMPER_STOMP_CC: Record<string, number> = { A: 17, B: 18, C: 19, D: 20, X: 22, MOD: 24, DELAY: 26, REVERB: 28, ALL: 16 }
export const KEMPER_STOMP_CC_WITH_TAIL: Record<string, number> = { DELAY: 27, REVERB: 29 }

/**
 * The NUX MG-30's knob CCs with a name a musician can read (the manual's "MIDI CC ASSIGNMENTS"
 * table, reproduced in the emulator's docs/protocol-notes.md): one CC per block and knob position.
 * What a knob does inside its block (Gain, Bass, …) depends on the model loaded in the patch, so
 * the name gives block and position only. Values run 0-100; three positions are switches or
 * selectors with a smaller range. Not the whole 11-74 span: CC 16 is unused, and compressor knob 4
 * is CC 90. `mg30.setKnob`'s `cc` payload field is the raw CC number.
 */
const knobs = (block: string, first: number, count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => [first + i, `${block} – Regler ${from + i}`] as const)
export const MG30_KNOBS: ReadonlyMap<number, string> = new Map<number, string>([
  [11, 'Wah – Regler 1'],
  [12, 'Wah – Schalter (0/1)'],
  ...knobs('Kompressor', 13, 3),
  [90, 'Kompressor – Regler 4'],
  ...knobs('Effekt', 17, 5),
  ...knobs('Amp', 22, 8),
  ...knobs('EQ', 30, 12),
  ...knobs('Noise Gate', 42, 3),
  [45, 'Noise Gate – Auswahl (0–6)'],
  ...knobs('Modulation', 46, 6),
  ...knobs('Delay', 52, 3),
  [55, 'Delay – Auswahl (0–6)'],
  ...knobs('Delay', 56, 4, 5),
  ...knobs('Reverb', 60, 4),
  ...knobs('IR', 64, 6),
  [70, 'Send-Pegel'],
  [71, 'Return-Pegel'],
  [72, 'Patch-Lautstärke'],
  [73, 'Aktiver Block'],
  [74, 'Pedal'],
])

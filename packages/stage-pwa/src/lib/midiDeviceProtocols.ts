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

/** Continuous knob CCs 11-74 of the NUX MG-30 (per-block ranges, `nux_mg30_emulator/cc_map.py`'s
 * `KNOB_CC_NAMES`) - `mg30.setKnob`'s `cc` payload field is the raw CC number, not a symbolic name. */
export const MG30_KNOB_CC_RANGE = { min: 11, max: 74 } as const

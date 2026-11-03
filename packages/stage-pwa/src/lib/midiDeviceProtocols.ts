import i18n from '../i18n'
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
/** A knob's place: block and position, a switch or selector of a block, or one of the patch-wide
 * controls (named by its CC). Translated when shown (`mg30KnobName`). */
export type Mg30Knob = { block: string; kind: 'knob'; n: number } | { block: string; kind: 'switch' | 'select' } | { kind: 'special' }
const knobs = (block: string, first: number, count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => [first + i, { block, kind: 'knob', n: from + i }] as const)
export const MG30_KNOBS: ReadonlyMap<number, Mg30Knob> = new Map<number, Mg30Knob>([
  [11, { block: 'Wah', kind: 'knob', n: 1 }],
  [12, { block: 'Wah', kind: 'switch' }],
  ...knobs('Kompressor', 13, 3),
  [90, { block: 'Kompressor', kind: 'knob', n: 4 }],
  ...knobs('Effekt', 17, 5),
  ...knobs('Amp', 22, 8),
  ...knobs('EQ', 30, 12),
  ...knobs('Noise Gate', 42, 3),
  [45, { block: 'Noise Gate', kind: 'select' }],
  ...knobs('Modulation', 46, 6),
  ...knobs('Delay', 52, 3),
  [55, { block: 'Delay', kind: 'select' }],
  ...knobs('Delay', 56, 4, 5),
  ...knobs('Reverb', 60, 4),
  ...knobs('IR', 64, 6),
  [70, { kind: 'special' }],
  [71, { kind: 'special' }],
  [72, { kind: 'special' }],
  [73, { kind: 'special' }],
  [74, { kind: 'special' }],
])

/** A knob's name in this device's language ("Delay – Regler 2"), undefined for an unknown CC. */
export function mg30KnobName(cc: number): string | undefined {
  const knob = MG30_KNOBS.get(cc)
  if (!knob) return undefined
  if (knob.kind === 'special') return i18n.t(`plugins:mg30.special.${cc}` as 'plugins:mg30.special.70')
  // Block names are the pedal's own English words, except two the German manual translates.
  const block = i18n.t(`plugins:mg30.block.${knob.block}` as 'plugins:mg30.block.Effekt', { defaultValue: knob.block })
  if (knob.kind === 'knob') return i18n.t('plugins:mg30.knob', { block, n: knob.n })
  return i18n.t(knob.kind === 'switch' ? 'plugins:mg30.switch' : 'plugins:mg30.select', { block })
}

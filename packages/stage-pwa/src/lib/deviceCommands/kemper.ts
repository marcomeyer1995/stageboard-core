import { KEMPER_STOMP_CC, KEMPER_STOMP_CC_WITH_TAIL } from '../midiDeviceProtocols'
import type { DeviceCommand } from './types'

/** Kemper Profiler cue commands - see kemperTranslator.ts for what each sends. */
export const KEMPER_COMMANDS: DeviceCommand[] = [
  {
    type: 'kemper.selectRig',
    label: 'Rig wählen',
    fields: [
      // Numbered 1-125 on the Kemper's display; the MIDI value is one less.
      { key: 'performance', label: 'Performance', kind: 'choice', options: Array.from({ length: 125 }, (_, i) => ({ value: i, label: String(i + 1) })) },
      { key: 'slot', label: 'Slot', kind: 'int', min: 1, max: 5 },
    ],
    describe: (p) => `Performance ${Number(p.performance) + 1}, Slot ${String(p.slot)}`,
    stateKey: () => 'rig',
  },
  {
    type: 'kemper.stomp',
    label: 'Stomp an/aus',
    fields: [
      { key: 'stomp', label: 'Stomp', kind: 'choice', options: Object.keys(KEMPER_STOMP_CC).map((name) => ({ value: name, label: name })) },
      // "aus" next to "an" (Marco, 2026-10-18): a pedal that switches an effect on must switch it off again.
      { key: 'off', label: 'Ausschalten', kind: 'bool' },
      { key: 'tail', label: `Mit Nachklang (nur ${Object.keys(KEMPER_STOMP_CC_WITH_TAIL).join('/')})`, kind: 'bool' },
    ],
    describe: (p) => `Stomp ${String(p.stomp)} ${p.off === true ? 'aus' : 'an'}${p.tail === true ? ' (Tail)' : ''}`,
    stateKey: (p) => `stomp:${String(p.stomp)}`,
  },
  {
    type: 'kemper.tuner',
    label: 'Tuner an/aus',
    fields: [{ key: 'off', label: 'Ausschalten', kind: 'bool' }],
    describe: (p) => `Tuner ${p.off === true ? 'aus' : 'an'}`,
    stateKey: () => 'tuner',
  },
]

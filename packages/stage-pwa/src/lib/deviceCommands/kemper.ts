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
  },
  {
    type: 'kemper.stomp',
    label: 'Stomp einschalten',
    fields: [
      { key: 'stomp', label: 'Stomp', kind: 'choice', options: Object.keys(KEMPER_STOMP_CC).map((name) => ({ value: name, label: name })) },
      { key: 'tail', label: `Mit Nachklang (nur ${Object.keys(KEMPER_STOMP_CC_WITH_TAIL).join('/')})`, kind: 'bool' },
    ],
    describe: (p) => `Stomp ${String(p.stomp)}${p.tail === true ? ' (Tail)' : ''}`,
  },
]

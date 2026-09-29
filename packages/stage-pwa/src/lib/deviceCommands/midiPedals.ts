import { MG30_KNOBS } from '../midiDeviceProtocols'
import type { DeviceCommand } from './types'

/** BOSS RC-500 cue commands - see rc500Translator.ts. */
export const RC500_COMMANDS: DeviceCommand[] = [
  {
    type: 'rc500.selectMemory',
    label: 'Memory wählen',
    fields: [{ key: 'memory', label: 'Memory', kind: 'int', min: 1, max: 99 }],
    describe: (p) => `Memory ${String(p.memory)}`,
  },
]

/** The MG-30's patch names: program 0 = 01A, 1 = 01B, 4 = 02A … 127 = 32D. */
export const mg30PatchName = (program: number) => `${String(Math.floor(program / 4) + 1).padStart(2, '0')}${'ABCD'[program % 4] ?? ''}`

/** NUX MG-30 cue commands - see mg30Translator.ts. */
export const MG30_COMMANDS: DeviceCommand[] = [
  {
    type: 'mg30.selectPatch',
    label: 'Patch wählen',
    fields: [{ key: 'program', label: 'Patch', kind: 'choice', options: Array.from({ length: 128 }, (_, program) => ({ value: program, label: mg30PatchName(program) })) }],
    describe: (p) => `Patch ${mg30PatchName(Number(p.program))}`,
  },
  {
    type: 'mg30.setKnob',
    label: 'Regler setzen',
    fields: [
      { key: 'cc', label: 'Regler', kind: 'choice', options: [...MG30_KNOBS].sort((a, b) => a[0] - b[0]).map(([cc, name]) => ({ value: cc, label: name })) },
      { key: 'value', label: 'Wert', kind: 'int', min: 0, max: 100 },
    ],
    describe: (p) => `${MG30_KNOBS.get(Number(p.cc)) ?? `CC ${String(p.cc)}`} = ${String(p.value)}`,
  },
]

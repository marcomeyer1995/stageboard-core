import i18n from '../../i18n'
import { MG30_KNOBS, mg30KnobName } from '../midiDeviceProtocols'
import type { DeviceCommand } from './types'

/** BOSS RC-500 cue commands - see rc500Translator.ts. */
export const RC500_COMMANDS: DeviceCommand[] = [
  {
    type: 'rc500.selectMemory',
    get label() {
      return i18n.t('plugins:cmd.selectMemory')
    },
    fields: [{ key: 'memory', label: 'Memory', kind: 'int', min: 1, max: 99 }],
    describe: (p) => `Memory ${String(p.memory)}`,
    stateKey: () => 'memory',
  },
]

/** The MG-30's patch names: program 0 = 01A, 1 = 01B, 4 = 02A … 127 = 32D. */
export const mg30PatchName = (program: number) => `${String(Math.floor(program / 4) + 1).padStart(2, '0')}${'ABCD'[program % 4] ?? ''}`

/** NUX MG-30 cue commands - see mg30Translator.ts. */
export const MG30_COMMANDS: DeviceCommand[] = [
  {
    type: 'mg30.selectPatch',
    get label() {
      return i18n.t('plugins:cmd.selectPatch')
    },
    fields: [{ key: 'program', label: 'Patch', kind: 'choice', options: Array.from({ length: 128 }, (_, program) => ({ value: program, label: mg30PatchName(program) })) }],
    describe: (p) => `Patch ${mg30PatchName(Number(p.program))}`,
    stateKey: () => 'patch',
  },
  {
    type: 'mg30.setKnob',
    get label() {
      return i18n.t('plugins:cmd.setKnob')
    },
    fields: [
      {
        key: 'cc',
        get label() {
          return i18n.t('plugins:field.knob')
        },
        kind: 'choice',
        get options() {
          return [...MG30_KNOBS.keys()].sort((a, b) => a - b).map((cc) => ({ value: cc, label: mg30KnobName(cc) ?? `CC ${cc}` }))
        },
      },
      {
        key: 'value',
        get label() {
          return i18n.t('plugins:field.value')
        },
        kind: 'int',
        min: 0,
        max: 100,
      },
    ],
    describe: (p) => `${mg30KnobName(Number(p.cc)) ?? `CC ${String(p.cc)}`} = ${String(p.value)}`,
    stateKey: (p) => `knob:${String(p.cc)}`,
  },
]

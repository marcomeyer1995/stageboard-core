import i18n from '../../i18n'
import { KEMPER_STOMP_CC, KEMPER_STOMP_CC_WITH_TAIL } from '../midiDeviceProtocols'
import type { DeviceCommand } from './types'

const onOff = (off: unknown) => i18n.t(off === true ? 'plugins:word.off' : 'plugins:word.on')

/** Kemper Profiler cue commands - see kemperTranslator.ts for what each sends. Texts are getters:
 * the language can change while the app runs (#456). */
export const KEMPER_COMMANDS: DeviceCommand[] = [
  {
    type: 'kemper.selectRig',
    get label() {
      return i18n.t('plugins:cmd.selectRig')
    },
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
    get label() {
      return i18n.t('plugins:cmd.stomp')
    },
    fields: [
      { key: 'stomp', label: 'Stomp', kind: 'choice', options: Object.keys(KEMPER_STOMP_CC).map((name) => ({ value: name, label: name })) },
      // "aus" next to "an" (Marco, 2026-10-18): a pedal that switches an effect on must switch it off again.
      {
        key: 'off',
        get label() {
          return i18n.t('plugins:field.switchOff')
        },
        kind: 'bool',
      },
      {
        key: 'tail',
        get label() {
          return i18n.t('plugins:field.tail', { list: Object.keys(KEMPER_STOMP_CC_WITH_TAIL).join('/') })
        },
        kind: 'bool',
      },
    ],
    describe: (p) => `${i18n.t('plugins:desc.stomp', { stomp: String(p.stomp), state: onOff(p.off) })}${p.tail === true ? ' (Tail)' : ''}`,
    stateKey: (p) => `stomp:${String(p.stomp)}`,
  },
  {
    type: 'kemper.tuner',
    get label() {
      return i18n.t('plugins:cmd.tuner')
    },
    fields: [
      {
        key: 'off',
        get label() {
          return i18n.t('plugins:field.switchOff')
        },
        kind: 'bool',
      },
    ],
    describe: (p) => i18n.t('plugins:desc.tuner', { state: onOff(p.off) }),
    stateKey: () => 'tuner',
  },
]

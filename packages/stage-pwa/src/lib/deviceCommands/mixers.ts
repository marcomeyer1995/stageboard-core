import i18n from '../../i18n'
import type { CommandField, DeviceCommand } from './types'

const onOff = (muted: unknown) => i18n.t(muted === true ? 'plugins:word.muted' : 'plugins:word.on')

/** A field whose label follows the language (#456) - a real getter, read each time it shows. */
const labelled = <T extends Omit<CommandField, 'label'>>(field: T, key: 'channel' | 'level' | 'muted' | 'channelType'): T & { readonly label: string } =>
  Object.defineProperty(field, 'label', { get: () => i18n.t(`plugins:field.${key}` as 'plugins:field.channel'), enumerable: true }) as T & { readonly label: string }

/** Allen & Heath CQ-18T cue commands - see cq18tTranslator.ts. */
export const CQ18T_COMMANDS: DeviceCommand[] = [
  {
    type: 'cq18t.setLevel',
    get label() {
      return i18n.t('plugins:cmd.setLevel')
    },
    fields: [
      labelled({ key: 'channel', kind: 'int', min: 1, max: 16 }, 'channel'),
      labelled({ key: 'db', kind: 'number', min: -60, max: 10, step: 1, unit: 'dB' }, 'level'),
    ],
    describe: (p) => `${i18n.t('plugins:desc.channel', { channel: String(p.channel) })}: ${String(p.db)} dB`,
    stateKey: (p) => `level:${String(p.channel)}`,
  },
  {
    type: 'cq18t.setMute',
    get label() {
      return i18n.t('plugins:cmd.setMute')
    },
    fields: [
      labelled({ key: 'channel', kind: 'choice', options: [{ value: 'main', label: 'Main' }, ...Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))] }, 'channel'),
      labelled({ key: 'muted', kind: 'bool' }, 'muted'),
    ],
    describe: (p) => `${p.channel === 'main' ? 'Main' : i18n.t('plugins:desc.channel', { channel: String(p.channel) })} ${onOff(p.muted)}`,
    stateKey: (p) => `mute:${String(p.channel)}`,
  },
]

/** Soundcraft Ui24R channel types (ui24rTranslator.ts's CHANNEL_COUNTS); two have German names. */
const UI24R_CHANNEL_TYPES: { value: string; label: string }[] = [
  {
    value: 'i',
    get label() {
      return i18n.t('plugins:ui24r.i')
    },
  },
  { value: 'l', label: 'Line (1-2)' },
  { value: 'p', label: 'Player (1-2)' },
  { value: 'f', label: 'FX (1-4)' },
  {
    value: 's',
    get label() {
      return i18n.t('plugins:ui24r.s')
    },
  },
  { value: 'a', label: 'Aux (1-10)' },
  { value: 'v', label: 'VCA (1-6)' },
]
const ui24rChannel = (p: Record<string, unknown>) => `${UI24R_CHANNEL_TYPES.find((t) => t.value === p.channelType)?.label.split(' ')[0] ?? String(p.channelType)} ${String(p.channel)}`

/** Soundcraft Ui24R cue commands - see ui24rTranslator.ts. */
export const UI24R_COMMANDS: DeviceCommand[] = [
  {
    type: 'ui24r.setLevel',
    get label() {
      return i18n.t('plugins:cmd.setLevel')
    },
    fields: [
      labelled({ key: 'channelType', kind: 'choice', options: UI24R_CHANNEL_TYPES }, 'channelType'),
      labelled({ key: 'channel', kind: 'int', min: 1, max: 24 }, 'channel'),
      labelled({ key: 'db', kind: 'number', min: -60, max: 10, step: 1, unit: 'dB' }, 'level'),
    ],
    describe: (p) => `${ui24rChannel(p)}: ${String(p.db)} dB`,
    stateKey: (p) => `level:${String(p.channelType)}${String(p.channel)}`,
  },
  {
    type: 'ui24r.setMute',
    get label() {
      return i18n.t('plugins:cmd.setMute')
    },
    fields: [
      labelled({ key: 'channelType', kind: 'choice', options: UI24R_CHANNEL_TYPES }, 'channelType'),
      labelled({ key: 'channel', kind: 'int', min: 1, max: 24 }, 'channel'),
      labelled({ key: 'mute', kind: 'bool' }, 'muted'),
    ],
    describe: (p) => `${ui24rChannel(p)} ${onOff(p.mute)}`,
    stateKey: (p) => `mute:${String(p.channelType)}${String(p.channel)}`,
  },
]

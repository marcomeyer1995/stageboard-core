import type { DeviceCommand } from './types'

const onOff = (muted: unknown) => (muted === true ? 'stumm' : 'an')

/** Allen & Heath CQ-18T cue commands - see cq18tTranslator.ts. */
export const CQ18T_COMMANDS: DeviceCommand[] = [
  {
    type: 'cq18t.setLevel',
    label: 'Pegel setzen',
    fields: [
      { key: 'channel', label: 'Kanal', kind: 'int', min: 1, max: 16 },
      { key: 'db', label: 'Pegel', kind: 'number', min: -60, max: 10, step: 1, unit: 'dB' },
    ],
    describe: (p) => `Kanal ${String(p.channel)}: ${String(p.db)} dB`,
  },
  {
    type: 'cq18t.setMute',
    label: 'Stummschalten',
    fields: [
      { key: 'channel', label: 'Kanal', kind: 'choice', options: [{ value: 'main', label: 'Main' }, ...Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))] },
      { key: 'muted', label: 'Stumm', kind: 'bool' },
    ],
    describe: (p) => `${p.channel === 'main' ? 'Main' : `Kanal ${String(p.channel)}`} ${onOff(p.muted)}`,
  },
]

/** Soundcraft Ui24R channel types (ui24rTranslator.ts's CHANNEL_COUNTS). */
const UI24R_CHANNEL_TYPES = [
  { value: 'i', label: 'Eingang (1-24)' },
  { value: 'l', label: 'Line (1-2)' },
  { value: 'p', label: 'Player (1-2)' },
  { value: 'f', label: 'FX (1-4)' },
  { value: 's', label: 'Subgruppe (1-6)' },
  { value: 'a', label: 'Aux (1-10)' },
  { value: 'v', label: 'VCA (1-6)' },
]
const ui24rChannel = (p: Record<string, unknown>) => `${UI24R_CHANNEL_TYPES.find((t) => t.value === p.channelType)?.label.split(' ')[0] ?? String(p.channelType)} ${String(p.channel)}`

/** Soundcraft Ui24R cue commands - see ui24rTranslator.ts. */
export const UI24R_COMMANDS: DeviceCommand[] = [
  {
    type: 'ui24r.setLevel',
    label: 'Pegel setzen',
    fields: [
      { key: 'channelType', label: 'Kanaltyp', kind: 'choice', options: UI24R_CHANNEL_TYPES },
      { key: 'channel', label: 'Kanal', kind: 'int', min: 1, max: 24 },
      { key: 'db', label: 'Pegel', kind: 'number', min: -60, max: 10, step: 1, unit: 'dB' },
    ],
    describe: (p) => `${ui24rChannel(p)}: ${String(p.db)} dB`,
  },
  {
    type: 'ui24r.setMute',
    label: 'Stummschalten',
    fields: [
      { key: 'channelType', label: 'Kanaltyp', kind: 'choice', options: UI24R_CHANNEL_TYPES },
      { key: 'channel', label: 'Kanal', kind: 'int', min: 1, max: 24 },
      { key: 'mute', label: 'Stumm', kind: 'bool' },
    ],
    describe: (p) => `${ui24rChannel(p)} ${onOff(p.mute)}`,
  },
]

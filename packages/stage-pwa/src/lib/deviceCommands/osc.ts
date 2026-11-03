import i18n from '../../i18n'
import type { DeviceCommand } from './types'

/** A generic OSC device (#484) - lighting and video software; sent by the Stage-Server
 * (core-backend oscPlugin.ts), which owns the address check and the argument types. */
export const OSC_CAPABILITY = 'osc'

export const OSC_COMMANDS: DeviceCommand[] = [
  {
    type: 'osc.send',
    get label() {
      return i18n.t('plugins:cmd.oscSend')
    },
    fields: [
      {
        key: 'address',
        get label() {
          return i18n.t('plugins:field.address')
        },
        kind: 'text',
        placeholder: '/cue/12/go',
        validate: (v) => (/^\/[^\s#*,?[\]{}]*$/.test(v) ? null : i18n.t('plugins:oscAddressInvalid')),
      },
      {
        key: 'args',
        get label() {
          return i18n.t('plugins:field.args')
        },
        kind: 'text',
        placeholder: '1 0.5 "Intro"',
        optional: true,
      },
    ],
    describe: (p) => `${String(p.address ?? '')}${typeof p.args === 'string' && p.args ? ` ${p.args}` : ''}`,
  },
]

import type { DeviceCommand } from './types'

/** A generic OSC device (#484) - lighting and video software; sent by the Stage-Server
 * (core-backend oscPlugin.ts), which owns the address check and the argument types. */
export const OSC_CAPABILITY = 'osc'

export const OSC_COMMANDS: DeviceCommand[] = [
  {
    type: 'osc.send',
    label: 'OSC senden',
    fields: [
      {
        key: 'address',
        label: 'Adresse',
        kind: 'text',
        placeholder: '/cue/12/go',
        validate: (v) => (/^\/[^\s#*,?[\]{}]*$/.test(v) ? null : 'beginnt mit „/“, ohne Leerzeichen.'),
      },
      { key: 'args', label: 'Werte (mit Leerzeichen getrennt, optional)', kind: 'text', placeholder: '1 0.5 "Intro"', optional: true },
    ],
    describe: (p) => `${String(p.address ?? '')}${typeof p.args === 'string' && p.args ? ` ${p.args}` : ''}`,
  },
]

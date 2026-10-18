import { describe, expect, it } from 'vitest'
import { switchUsage } from './switchUsage'

const toSwitch = { kind: 'switch' as const, switchId: 'bl' }

describe('switchUsage (docs/23 §11.4)', () => {
  it('lists the pedal keys here, the MIDI buttons and the dashboard buttons that trigger a switch', () => {
    const usage = switchUsage('bl', {
      bindings: [{ key: 'b', behavior: toSwitch }, { key: 'PageDown', behavior: { kind: 'momentary', press: { kind: 'show', op: 'next' }, release: { kind: 'none' } } }],
      midiDocs: [{ id: 'fcb', rules: [{ id: 'r', trigger: { message: 'note', channel: 1, number: 36 }, behavior: toSwitch }] }],
      devices: [{ id: 'fcb', name: 'FCB', capability: 'midi-controller', pluginId: null, executionTarget: null }],
      dashboards: [{ id: 'd', name: 'Monitoring', widgets: [{ i: 'w', type: 'custom-trigger', config: { action: toSwitch }, frameless: false }] } as never],
    })
    expect(usage).toEqual(['Taste B (dieses Gerät)', 'FCB Note 36 · Kanal 1', 'Knopf auf „Monitoring“'])
  })
})

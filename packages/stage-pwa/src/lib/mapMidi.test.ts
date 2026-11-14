import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_MODELS, defaultStageMap, equipmentFrom } from 'shared-types'

// workspaceDb.ts constructs a real PouchDB at module load time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))
vi.mock('./deviceId', () => ({ getDeviceId: () => 'fire' }))

import { mapMidiName } from './mapMidi'
import { usePracticeRouteStore } from './outputPlan'
import { useStageMapStore } from '../store/useStageMapStore'

function map() {
  const m = defaultStageMap([{ id: 'fire', name: 'Fire' }])
  m.equipment.push(equipmentFrom(BUILTIN_MODELS.find((model) => model.id === 'amp-modeller')!, 'kemper', 'Kemper'))
  const routing = { 'device:fire': [{ from: { kind: 'virtual' as const, virtualPortId: 'ld-kemper' }, to: { kind: 'port' as const, portId: 'usb' } }] }
  const cable = (midiName: string) => ({ id: 'usb', from: { equipmentId: 'device:fire', portId: 'usb' }, to: { equipmentId: 'kemper', portId: 'usb' }, signals: ['midi' as const], midiName })
  m.setups[0]!.positions.kemper = { x: 0, y: 0 }
  m.setups[0]!.routing = routing
  m.setups[0]!.links.push(cable('Kemper Stage'))
  m.setups.push({ id: 'home', name: 'Home', owner: 'marco', positions: { ...m.setups[0]!.positions }, links: [cable('Kemper Player')], routing })
  return m
}

afterEach(() => usePracticeRouteStore.setState({ route: null }))

describe('the MIDI port of a plugin device (docs/31 §6 step 2)', () => {
  it('comes from the cable in the band\'s active setup - while practising by a setup, from that one (#799 step 4)', () => {
    const m = map()
    useStageMapStore.setState({ equipment: m.equipment, setups: [m.setups[0]!], loaded: true })
    expect(mapMidiName('ld-kemper')).toBe('Kemper Stage')
    usePracticeRouteStore.setState({ route: { map: m, setupId: 'home' } })
    expect(mapMidiName('ld-kemper')).toBe('Kemper Player')
    expect(mapMidiName('ld-other')).toBeNull()
  })
})

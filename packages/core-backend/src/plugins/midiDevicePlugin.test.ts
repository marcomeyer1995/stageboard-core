import { afterEach, describe, expect, it } from 'vitest'
import { createAddonMethods, loadAddonInfos } from '../addons/addonMethods.js'
import type { NativeMidi } from '../nativeMidi.js'
import { createMidiDeviceAddonPlugin, midiTargetFromConfig, setMidiTargetResolver } from './midiDevicePlugin.js'

/** This machine's MIDI as a recorder: what reached which port. */
function recordingMidi() {
  const sent: { port: string; bytes: number[] }[] = []
  const midi: NativeMidi = {
    outputs: () => ['Kemper:Kemper MIDI 1 24:0'],
    inputs: () => [],
    send: (port, bytes) => (sent.push({ port, bytes: [...bytes] }), port === 'Kemper:Kemper MIDI 1 24:0'),
    sendAndWait: async () => null,
    listen: () => null,
  }
  return { midi, sent }
}

const kemperInfo = () => loadAddonInfos().find((info) => info.id === 'kemper-profiler')!
const log = { info: () => {}, error: () => {} }

afterEach(() => setMidiTargetResolver(async () => null))

describe('a MIDI device plugged into the host gets its cues through its add-on (#964)', () => {
  it('reads port and channel from the device\'s transport config; channel 1 when it makes no sense, null without a port', () => {
    const doc = (values: Record<string, string>) => ({ id: 'h:l', deviceId: 'h', logicalDeviceId: 'l', transportId: null, values })
    expect(midiTargetFromConfig(doc({ midiOutputId: 'Kemper MIDI 1', midiChannel: '3' }))).toEqual({ port: 'Kemper MIDI 1', channel: 3 })
    expect(midiTargetFromConfig(doc({ midiOutputId: 'Kemper MIDI 1', midiChannel: '99' }))).toEqual({ port: 'Kemper MIDI 1', channel: 1 })
    expect(midiTargetFromConfig(doc({ midiChannel: '3' }))).toBeNull()
  })

  it('the Kemper add-on, in its real sandbox, turns a rig change into the two CCs on the device\'s own channel and port', async () => {
    const { midi, sent } = recordingMidi()
    const methods = createAddonMethods({ dirs: ['kemper'], midi, log })
    setMidiTargetResolver(async (pluginId, logicalDeviceId) => (pluginId === 'kemper-profiler' && logicalDeviceId === 'kemper-1' ? { port: 'Kemper:Kemper MIDI 1 24:0', channel: 2 } : null))
    const plugin = createMidiDeviceAddonPlugin(kemperInfo(), { methods })
    plugin.init({ log })
    const result = await plugin.trigger({ type: 'kemper.selectRig', payload: { performance: 7, slot: 3 }, logicalDeviceId: 'kemper-1' })
    expect(result).toEqual({ status: 'ok', data: { performance: 7, slot: 3 } })
    expect(sent).toEqual([
      { port: 'Kemper:Kemper MIDI 1 24:0', bytes: [0xb1, 47, 7] },
      { port: 'Kemper:Kemper MIDI 1 24:0', bytes: [0xb1, 52, 127] },
    ])
  })

  it('a cue the add-on refuses sends nothing and says why in its own words', async () => {
    const { midi, sent } = recordingMidi()
    const methods = createAddonMethods({ dirs: ['kemper'], midi, log })
    setMidiTargetResolver(async () => ({ port: 'Kemper:Kemper MIDI 1 24:0', channel: 1 }))
    const plugin = createMidiDeviceAddonPlugin(kemperInfo(), { methods })
    expect(await plugin.trigger({ type: 'kemper.selectRig', payload: { performance: 200, slot: 1 } })).toEqual({ status: 'error', message: 'kemper.selectRig: performance muss 0-124 sein.' })
    expect(await plugin.trigger({ type: 'kemper.stomp', payload: { stomp: 'Q' } })).toMatchObject({ status: 'error' })
    expect(sent).toEqual([])
  })

  it('a device without a port on this host is an error, and the add-on is not asked', async () => {
    const { midi, sent } = recordingMidi()
    const methods = createAddonMethods({ dirs: ['kemper'], midi, log })
    const plugin = createMidiDeviceAddonPlugin(kemperInfo(), { methods })
    expect(await plugin.trigger({ type: 'kemper.tuner', payload: {} })).toMatchObject({ status: 'error', messageCode: 'plugin.noMidiOut', messageParams: { device: 'Kemper Profiler' } })
    expect(sent).toEqual([])
  })

  it('an unplugged device: the add-on says so in its own words', async () => {
    const { midi } = recordingMidi()
    const methods = createAddonMethods({ dirs: ['kemper'], midi, log })
    setMidiTargetResolver(async () => ({ port: 'Gone', channel: 1 }))
    const plugin = createMidiDeviceAddonPlugin(kemperInfo(), { methods })
    expect(await plugin.trigger({ type: 'kemper.tuner', payload: {} })).toEqual({ status: 'error', message: 'Kemper nicht erreichbar: nicht angeschlossen oder ausgeschaltet.' })
  })

  it('"Testen" flashes the tuner: on, then off', async () => {
    const { midi, sent } = recordingMidi()
    const methods = createAddonMethods({ dirs: ['kemper'], midi, log })
    setMidiTargetResolver(async () => ({ port: 'Kemper:Kemper MIDI 1 24:0', channel: 1 }))
    const plugin = createMidiDeviceAddonPlugin(kemperInfo(), { methods })
    expect(await plugin.trigger({ type: 'test', payload: {} })).toEqual({ status: 'ok' })
    expect(sent.map((s) => s.bytes)).toEqual([[0xb0, 31, 127], [0xb0, 31, 0]])
  })
})

describe('the MG-30 and RC-500 add-ons on a host (#964)', () => {
  const info = (id: string) => loadAddonInfos().find((addon) => addon.id === id)!
  it('MG-30 "Testen" asks for its identity and reads the firmware from the reply the host waited for', async () => {
    const asked: { port: string; bytes: readonly number[]; prefix: readonly number[] }[] = []
    const midi: NativeMidi = {
      outputs: () => ['MG-30'],
      inputs: () => ['MG-30'],
      send: () => true,
      sendAndWait: async (port, bytes, prefix) => (asked.push({ port, bytes, prefix }), [0xf0, 0x43, 0x58, 0x10, ...Array.from('v4.0.3', (c) => c.charCodeAt(0)), 0, 0xf7]),
      listen: () => null,
    }
    setMidiTargetResolver(async () => ({ port: 'MG-30', channel: 1 }))
    const plugin = createMidiDeviceAddonPlugin(info('nux-mg30'), { methods: createAddonMethods({ dirs: ['nux-mg30'], midi, log }) })
    expect(await plugin.trigger({ type: 'test', payload: {} })).toEqual({ status: 'ok', message: 'Firmware v4.0.3' })
    expect(asked).toEqual([{ port: 'MG-30', bytes: [0xf0, 0x43, 0x58, 0x00, 0xf7], prefix: [0xf0, 0x43, 0x58, 0x10] }])
  })

  it('RC-500: a memory goes out as Program Change memory - 1', async () => {
    const { midi, sent } = recordingMidi()
    setMidiTargetResolver(async () => ({ port: 'Kemper:Kemper MIDI 1 24:0', channel: 2 }))
    const plugin = createMidiDeviceAddonPlugin(info('boss-rc500'), { methods: createAddonMethods({ dirs: ['boss-rc500'], midi, log }) })
    expect(await plugin.trigger({ type: 'rc500.selectMemory', payload: { memory: 12 } })).toEqual({ status: 'ok', data: { memory: 12 } })
    expect(sent.map((s) => s.bytes)).toEqual([[0xc1, 11]])
  })
})

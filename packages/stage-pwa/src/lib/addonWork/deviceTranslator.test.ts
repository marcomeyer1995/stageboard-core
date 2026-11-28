import KEMPER_WORK from '../../../../../addons/kemper/work.js?raw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

vi.mock('../mapMidi', () => ({ midiOutputFor: vi.fn() }))
vi.mock('../webMidi', () => ({ isWebMidiSupported: () => true }))
/** The reply a device gives to a request that waits for one (the MG-30's identity); null: none in time. */
const deviceReply: { bytes: number[] | null } = { bytes: null }
vi.mock('../addonSandbox/sandboxTranslator', () => ({
  sendAndWaitForReply: async (output: MIDIOutput, bytes: number[]) => (output.send(bytes), deviceReply.bytes ? Uint8Array.from(deviceReply.bytes) : null),
}))
// The stores import workspaceDb.ts, which builds a real PouchDB at load time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { midiOutputFor } = await import('../mapMidi')
const { addonDeviceTranslator } = await import('./deviceTranslator')
const { createLocalAddonMethods } = await import('./localMethods')
const { getDeviceId } = await import('../deviceId')
const { useDeviceTransportConfigStore } = await import('../../store/useDeviceTransportConfigStore')
const { useLogicalDevicesStore } = await import('../../store/useLogicalDevicesStore')

/** The real Kemper work script, in-process behind the Worker's message interface. */
function inProcessWorker(code: string) {
  const worker = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null, terminate: () => {}, postMessage: (m: unknown) => void queueMicrotask(() => scope.onmessage?.({ data: m })) }
  const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: (m) => void queueMicrotask(() => worker.onmessage?.({ data: m })) }
  new Function('self', code)(scope)
  return worker
}
expect(KEMPER_WORK).toContain('capability.midi-out')

/** A MIDI output that records what was sent to it. */
const output = (id: string) => {
  const sent: number[][] = []
  return { port: { id, send: (bytes: number[]) => void sent.push([...bytes]) } as unknown as MIDIOutput, sent }
}

const KEMPER: LogicalDevice = { id: 'kemper-1', name: "Marco's Kemper", capability: 'kemper-control', pluginId: null, executionTarget: null }
const config = (logicalDeviceId: string, values: Record<string, string>): DeviceTransportConfig => ({ id: `${getDeviceId()}:${logicalDeviceId}`, deviceId: getDeviceId(), logicalDeviceId, transportId: 'usb-midi', values })

let first: ReturnType<typeof output>
let kemper: ReturnType<typeof addonDeviceTranslator>

beforeEach(() => {
  first = output('midi-out-1')
  vi.mocked(midiOutputFor).mockReset().mockImplementation(async (_device, id) => (id === 'midi-out-1' ? first.port : null))
  useLogicalDevicesStore.setState({ devices: [KEMPER], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [config('kemper-1', { midiOutputId: 'midi-out-1', midiChannel: '1' })], loaded: true })
  const methods = createLocalAddonMethods({ helpersFor: async () => null, language: () => 'de', createWorker: inProcessWorker })
  kemper = addonDeviceTranslator('kemper-control', 'kemper-profiler', 'Kemper', async () => methods)
})

describe('the Kemper in the app runs through its add-on - the same work script a laptop host runs (#964)', () => {
  it('a rig change: performance preselect, then the slot CC, on the device\'s own port and channel', async () => {
    expect(await kemper({ type: 'kemper.selectRig', payload: { performance: 12, slot: 3 } })).toEqual({ status: 'ok', data: { performance: 12, slot: 3 } })
    expect(first.sent).toEqual([[0xb0, 47, 12], [0xb0, 52, 127]])
  })

  it('uses the channel set up for the device', async () => {
    useDeviceTransportConfigStore.setState({ configs: [config('kemper-1', { midiOutputId: 'midi-out-1', midiChannel: '4' })] })
    await kemper({ type: 'kemper.selectRig', payload: { performance: 0, slot: 1 } })
    expect(first.sent[0]).toEqual([0xb3, 47, 0])
  })

  it('#149: with two Kempers, a cue for the second goes to its own port and channel', async () => {
    const second = output('midi-out-2')
    vi.mocked(midiOutputFor).mockImplementation(async (_device, id) => (id === 'midi-out-2' ? second.port : first.port))
    useLogicalDevicesStore.setState({ devices: [KEMPER, { ...KEMPER, id: 'kemper-2', name: 'Backup Kemper' }] })
    useDeviceTransportConfigStore.setState({ configs: [config('kemper-1', { midiOutputId: 'midi-out-1', midiChannel: '1' }), config('kemper-2', { midiOutputId: 'midi-out-2', midiChannel: '3' })] })
    await kemper({ type: 'kemper.selectRig', payload: { performance: 0, slot: 1 }, logicalDeviceId: 'kemper-2' })
    expect(second.sent[0]).toEqual([0xb2, 47, 0])
    expect(first.sent).toEqual([])
  })

  it('stomps: the documented CC, case-insensitive, off with 0, the tail variant for delay and reverb', async () => {
    await kemper({ type: 'kemper.stomp', payload: { stomp: 'A' } })
    await kemper({ type: 'kemper.stomp', payload: { stomp: 'a', off: true } })
    await kemper({ type: 'kemper.stomp', payload: { stomp: 'mod' } })
    await kemper({ type: 'kemper.stomp', payload: { stomp: 'DELAY', tail: true } })
    await kemper({ type: 'kemper.stomp', payload: { stomp: 'REVERB', tail: true } })
    expect(first.sent).toEqual([[0xb0, 17, 127], [0xb0, 17, 0], [0xb0, 24, 127], [0xb0, 27, 127], [0xb0, 29, 127]])
  })

  it('the tuner on and off on CC 31, and "Testen" flashes it', async () => {
    await kemper({ type: 'kemper.tuner', payload: {} })
    await kemper({ type: 'kemper.tuner', payload: { off: true } })
    expect(await kemper({ type: 'test' })).toEqual({ status: 'ok' })
    expect(first.sent).toEqual([[0xb0, 31, 127], [0xb0, 31, 0], [0xb0, 31, 127], [0xb0, 31, 0]])
  })

  it('refuses what makes no sense in the add-on\'s words, and sends nothing', async () => {
    expect(await kemper({ type: 'kemper.selectRig', payload: { performance: 125, slot: 1 } })).toEqual({ status: 'error', message: 'kemper.selectRig: performance muss 0-124 sein.' })
    expect(await kemper({ type: 'kemper.selectRig', payload: { performance: 1, slot: 6 } })).toMatchObject({ status: 'error' })
    expect(await kemper({ type: 'kemper.stomp', payload: { stomp: 'Q' } })).toMatchObject({ status: 'error' })
    expect(await kemper({ type: 'something.else' })).toMatchObject({ status: 'error' })
    expect(first.sent).toEqual([])
  })

  it('without a Kemper, or without a port on this device, says so before the add-on is asked', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    expect(await kemper({ type: 'test' })).toMatchObject({ status: 'error' })
    useLogicalDevicesStore.setState({ devices: [KEMPER] })
    useDeviceTransportConfigStore.setState({ configs: [] })
    expect(await kemper({ type: 'test' })).toMatchObject({ status: 'error' })
    expect(first.sent).toEqual([])
  })
})

describe('the NUX MG-30 and the BOSS RC-500 run through their add-ons the same way (#964)', () => {
  const MG30: LogicalDevice = { id: 'mg30', name: 'MG-30', capability: 'mg30-control', pluginId: null, executionTarget: null }
  const RC500: LogicalDevice = { id: 'rc500', name: 'RC-500', capability: 'rc500-control', pluginId: null, executionTarget: null }
  let mg30: ReturnType<typeof addonDeviceTranslator>
  let rc500: ReturnType<typeof addonDeviceTranslator>

  beforeEach(() => {
    deviceReply.bytes = null
    useLogicalDevicesStore.setState({ devices: [MG30, RC500], loaded: true })
    useDeviceTransportConfigStore.setState({ configs: [config('mg30', { midiOutputId: 'midi-out-1', midiChannel: '1' }), config('rc500', { midiOutputId: 'midi-out-1', midiChannel: '1' })], loaded: true })
    const methods = createLocalAddonMethods({ helpersFor: async () => null, language: () => 'de', createWorker: inProcessWorker })
    mg30 = addonDeviceTranslator('mg30-control', 'nux-mg30', 'MG-30', async () => methods)
    rc500 = addonDeviceTranslator('rc500-control', 'boss-rc500', 'RC-500', async () => methods)
  })

  it('MG-30: a patch is a Program Change, named bank and letter (0 -> 01A, 127 -> 32D), on the device\'s channel', async () => {
    expect(await mg30({ type: 'mg30.selectPatch', payload: { program: 0 } })).toEqual({ status: 'ok', data: { program: 0, patchName: '01A' } })
    expect(await mg30({ type: 'mg30.selectPatch', payload: { program: 127 } })).toEqual({ status: 'ok', data: { program: 127, patchName: '32D' } })
    useDeviceTransportConfigStore.setState({ configs: [config('mg30', { midiOutputId: 'midi-out-1', midiChannel: '3' })] })
    await mg30({ type: 'mg30.selectPatch', payload: { program: 5 } })
    expect(first.sent).toEqual([[0xc0, 0], [0xc0, 127], [0xc2, 5]])
  })

  it('MG-30: a knob is a plain CC; CC 90 is a knob, the block CCs 0-10 and 16 are not; out-of-range values are refused', async () => {
    expect(await mg30({ type: 'mg30.setKnob', payload: { cc: 20, value: 64 } })).toEqual({ status: 'ok', data: { cc: 20, value: 64 } })
    expect(await mg30({ type: 'mg30.setKnob', payload: { cc: 90, value: 1 } })).toMatchObject({ status: 'ok' })
    for (const cc of [0, 10, 16, 74, 91]) expect(await mg30({ type: 'mg30.setKnob', payload: { cc, value: 1 } }), String(cc)).toEqual({ status: 'error', message: `mg30.setKnob: CC ${cc} ist kein Regler des MG-30.` })
    expect(await mg30({ type: 'mg30.setKnob', payload: { cc: 20, value: 128 } })).toMatchObject({ status: 'error' })
    expect(await mg30({ type: 'mg30.selectPatch', payload: { program: 128 } })).toMatchObject({ status: 'error' })
    expect(first.sent).toEqual([[0xb0, 20, 64], [0xb0, 90, 1]])
  })

  it('MG-30 "Testen": the identity request, and the firmware from the real reply; no reply in time is an error', async () => {
    deviceReply.bytes = [0xf0, 0x43, 0x58, 0x10, ...Array.from('v4.0.3', (c) => c.charCodeAt(0)), 0, 0, 0xf7]
    expect(await mg30({ type: 'test' })).toEqual({ status: 'ok', message: 'Firmware v4.0.3' })
    expect(first.sent).toEqual([[0xf0, 0x43, 0x58, 0x00, 0xf7]])
    deviceReply.bytes = null
    expect(await mg30({ type: 'test' })).toEqual({ status: 'error', message: 'MG-30: keine Antwort auf die Identitätsabfrage.' })
  })

  it('RC-500: a memory is a Program Change with the wire value memory - 1 (1-99), on the device\'s channel', async () => {
    expect(await rc500({ type: 'rc500.selectMemory', payload: { memory: 1 } })).toEqual({ status: 'ok', data: { memory: 1 } })
    await rc500({ type: 'rc500.selectMemory', payload: { memory: 99 } })
    for (const memory of [0, 100]) expect(await rc500({ type: 'rc500.selectMemory', payload: { memory } })).toMatchObject({ status: 'error' })
    expect(first.sent).toEqual([[0xc0, 0], [0xc0, 98]])
  })

  it('RC-500 "Testen" says honestly that it cannot test, without sending anything - and still needs a port first', async () => {
    expect(await rc500({ type: 'test' })).toEqual({ status: 'error', message: 'RC-500: kein automatischer Test möglich - das Gerät hat keine Rückmeldung.' })
    expect(first.sent).toEqual([])
    useDeviceTransportConfigStore.setState({ configs: [] })
    expect(await rc500({ type: 'test' })).toMatchObject({ status: 'error', message: expect.not.stringContaining('automatischer') })
  })
})

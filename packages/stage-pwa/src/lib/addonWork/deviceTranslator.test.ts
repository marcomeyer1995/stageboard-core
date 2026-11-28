import KEMPER_WORK from '../../../../core-backend/scripts/addons/kemper/work.js?raw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

vi.mock('../mapMidi', () => ({ midiOutputFor: vi.fn() }))
vi.mock('../webMidi', () => ({ isWebMidiSupported: () => true }))
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

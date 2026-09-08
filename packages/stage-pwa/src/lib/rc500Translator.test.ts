import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

vi.mock('./webMidiOutput', () => ({
  getMidiOutputById: vi.fn(),
}))

// Same reasoning as mg30Translator.test.ts/cq18tTranslator.test.ts - this module transitively
// imports workspaceDb.ts, which constructs a real PouchDB at module load time.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { getMidiOutputById } = await import('./webMidiOutput')
const { RC500_CAPABILITY, rc500Translator } = await import('./rc500Translator')
const { getDeviceId } = await import('./deviceId')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

const LOGICAL_DEVICE: LogicalDevice = {
  id: 'rc500-1',
  name: 'Marcos RC-500',
  capability: RC500_CAPABILITY,
  pluginId: null,
  executionTarget: null,
}
const send = vi.fn()
const OUTPUT = { id: 'midi-out-1', send } as unknown as MIDIOutput

function configWith(values: Record<string, string>): DeviceTransportConfig {
  return { id: `${getDeviceId()}:rc500-1`, deviceId: getDeviceId(), logicalDeviceId: 'rc500-1', transportId: 'usb-midi', values }
}

beforeEach(() => {
  vi.mocked(getMidiOutputById).mockReset().mockResolvedValue(OUTPUT)
  send.mockReset()
  useLogicalDevicesStore.setState({ devices: [LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '1' })], loaded: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rc500Translator', () => {
  it('errors when no Logical Device declares rc500-control', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    const result = await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 1 } })
    expect(result.status).toBe('error')
  })

  it('errors when no DeviceTransportConfig is set up for this tablet', async () => {
    useDeviceTransportConfigStore.setState({ configs: [] })
    const result = await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 1 } })
    expect(result.status).toBe('error')
  })

  it('errors on an unknown event type', async () => {
    const result = await rc500Translator({ type: 'something.else' })
    expect(result.status).toBe('error')
  })

  describe('rc500.selectMemory', () => {
    it('sends a Program Change with the wire value memory-1', async () => {
      const result = await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 1 } })
      expect(result.status).toBe('ok')
      expect(send).toHaveBeenCalledWith([0xc0, 0])
      expect(result.data).toEqual({ memory: 1 })
    })

    it('memory 99 -> wire value 98', async () => {
      await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 99 } })
      expect(send).toHaveBeenCalledWith([0xc0, 98])
    })

    it('uses the configured MIDI channel', async () => {
      useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '4' })] })
      await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 1 } })
      expect(send).toHaveBeenCalledWith([0xc3, 0]) // channel 4 -> 0-indexed 3
    })

    it('rejects an out-of-range memory', async () => {
      const result = await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 100 } })
      expect(result.status).toBe('error')
      expect(send).not.toHaveBeenCalled()
    })

    it('rejects memory 0 (wire values are 1-indexed for humans)', async () => {
      const result = await rc500Translator({ type: 'rc500.selectMemory', payload: { memory: 0 } })
      expect(result.status).toBe('error')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('test', () => {
    it('honestly reports that no automatic test is possible, without sending anything', async () => {
      const result = await rc500Translator({ type: 'test' })
      expect(result.status).toBe('error')
      expect(result.message).toContain('kein automatischer Test möglich')
      expect(send).not.toHaveBeenCalled()
    })

    it('still requires a configured MIDI output before reporting the no-test message', async () => {
      useDeviceTransportConfigStore.setState({ configs: [] })
      const result = await rc500Translator({ type: 'test' })
      expect(result.message).toContain('kein MIDI-Ausgang konfiguriert')
    })
  })
})

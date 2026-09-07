import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

vi.mock('./webMidiOutput', () => ({
  getMidiOutputById: vi.fn(),
  sendControlChange: vi.fn(),
}))

// This module transitively imports workspaceDb.ts, which constructs a real PouchDB at module
// load time - unavailable under happy-dom (see SystemView.test.tsx/workspaceDb.test.ts's
// identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { getMidiOutputById, sendControlChange } = await import('./webMidiOutput')
const { KEMPER_CAPABILITY, kemperTranslator } = await import('./kemperTranslator')
const { getDeviceId } = await import('./deviceId')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

const LOGICAL_DEVICE: LogicalDevice = {
  id: 'kemper-1',
  name: "Marco's Kemper",
  capability: KEMPER_CAPABILITY,
  pluginId: null,
  executionTarget: null,
}
const OUTPUT = { id: 'midi-out-1' } as MIDIOutput

function configWith(values: Record<string, string>): DeviceTransportConfig {
  return { id: `${getDeviceId()}:kemper-1`, deviceId: getDeviceId(), logicalDeviceId: 'kemper-1', transportId: 'usb-midi', values }
}

beforeEach(() => {
  vi.mocked(getMidiOutputById).mockReset().mockResolvedValue(OUTPUT)
  vi.mocked(sendControlChange).mockReset()
  useLogicalDevicesStore.setState({ devices: [LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '1' })], loaded: true })
})

describe('kemperTranslator', () => {
  it('errors when no Logical Device declares kemper-control', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    const result = await kemperTranslator({ type: 'test' })
    expect(result.status).toBe('error')
    expect(sendControlChange).not.toHaveBeenCalled()
  })

  it('errors when no DeviceTransportConfig is set up for this tablet', async () => {
    useDeviceTransportConfigStore.setState({ configs: [] })
    const result = await kemperTranslator({ type: 'test' })
    expect(result.status).toBe('error')
  })

  it('errors on an unknown event type', async () => {
    const result = await kemperTranslator({ type: 'something.else' })
    expect(result.status).toBe('error')
    expect(sendControlChange).not.toHaveBeenCalled()
  })

  describe('kemper.selectRig', () => {
    it('sends performance-preselect then the matching slot CC, 0-indexed channel', async () => {
      const result = await kemperTranslator({ type: 'kemper.selectRig', payload: { performance: 12, slot: 3 } })
      expect(result.status).toBe('ok')
      expect(sendControlChange).toHaveBeenNthCalledWith(1, OUTPUT, 0, 47, 12)
      expect(sendControlChange).toHaveBeenNthCalledWith(2, OUTPUT, 0, 52, 127) // CC_SLOT_3
    })

    it('rejects an out-of-range performance', async () => {
      const result = await kemperTranslator({ type: 'kemper.selectRig', payload: { performance: 125, slot: 1 } })
      expect(result.status).toBe('error')
      expect(sendControlChange).not.toHaveBeenCalled()
    })

    it('rejects an out-of-range slot', async () => {
      const result = await kemperTranslator({ type: 'kemper.selectRig', payload: { performance: 0, slot: 6 } })
      expect(result.status).toBe('error')
      expect(sendControlChange).not.toHaveBeenCalled()
    })

    it('uses the configured MIDI channel', async () => {
      useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '4' })] })
      await kemperTranslator({ type: 'kemper.selectRig', payload: { performance: 0, slot: 1 } })
      expect(sendControlChange).toHaveBeenNthCalledWith(1, OUTPUT, 3, 47, 0) // channel 4 -> 0-indexed 3
    })
  })

  describe('kemper.stomp', () => {
    it('maps a stomp name to its documented CC', async () => {
      const result = await kemperTranslator({ type: 'kemper.stomp', payload: { stomp: 'A' } })
      expect(result.status).toBe('ok')
      expect(sendControlChange).toHaveBeenCalledWith(OUTPUT, 0, 17, 127)
    })

    it('is case-insensitive', async () => {
      await kemperTranslator({ type: 'kemper.stomp', payload: { stomp: 'mod' } })
      expect(sendControlChange).toHaveBeenCalledWith(OUTPUT, 0, 24, 127)
    })

    it('uses the tail-variant CC for delay/reverb when tail: true', async () => {
      await kemperTranslator({ type: 'kemper.stomp', payload: { stomp: 'DELAY', tail: true } })
      expect(sendControlChange).toHaveBeenCalledWith(OUTPUT, 0, 27, 127)
      vi.mocked(sendControlChange).mockClear()
      await kemperTranslator({ type: 'kemper.stomp', payload: { stomp: 'REVERB', tail: true } })
      expect(sendControlChange).toHaveBeenCalledWith(OUTPUT, 0, 29, 127)
    })

    it('errors on an unknown stomp name', async () => {
      const result = await kemperTranslator({ type: 'kemper.stomp', payload: { stomp: 'NOPE' } })
      expect(result.status).toBe('error')
      expect(sendControlChange).not.toHaveBeenCalled()
    })
  })

  describe('test', () => {
    it('flashes the tuner CC on then off', async () => {
      const result = await kemperTranslator({ type: 'test' })
      expect(result.status).toBe('ok')
      expect(sendControlChange).toHaveBeenNthCalledWith(1, OUTPUT, 0, 31, 127)
      expect(sendControlChange).toHaveBeenNthCalledWith(2, OUTPUT, 0, 31, 0)
    })
  })
})

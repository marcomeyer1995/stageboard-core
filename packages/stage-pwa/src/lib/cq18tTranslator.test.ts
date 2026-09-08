import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

vi.mock('./webMidiOutput', () => ({
  getMidiOutputById: vi.fn(),
  sendNrpn: vi.fn(),
}))
vi.mock('./webMidi', () => ({
  isWebMidiSupported: vi.fn().mockReturnValue(true),
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

const { getMidiOutputById, sendNrpn } = await import('./webMidiOutput')
const { isWebMidiSupported } = await import('./webMidi')
const { CQ18T_CAPABILITY, cq18tTranslator } = await import('./cq18tTranslator')
const { getDeviceId } = await import('./deviceId')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

const LOGICAL_DEVICE: LogicalDevice = {
  id: 'cq18t-1',
  name: 'FOH-Pult',
  capability: CQ18T_CAPABILITY,
  pluginId: null,
  executionTarget: null,
}
const send = vi.fn()
const OUTPUT = { id: 'midi-out-1', send } as unknown as MIDIOutput

function configWith(values: Record<string, string>): DeviceTransportConfig {
  return { id: `${getDeviceId()}:cq18t-1`, deviceId: getDeviceId(), logicalDeviceId: 'cq18t-1', transportId: 'usb-midi', values }
}

beforeEach(() => {
  vi.mocked(isWebMidiSupported).mockReturnValue(true)
  vi.mocked(getMidiOutputById).mockReset().mockResolvedValue(OUTPUT)
  vi.mocked(sendNrpn).mockReset()
  send.mockReset()
  useLogicalDevicesStore.setState({ devices: [LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '1' })], loaded: true })
})

describe('cq18tTranslator', () => {
  it('errors when WebMIDI is unsupported', async () => {
    vi.mocked(isWebMidiSupported).mockReturnValue(false)
    const result = await cq18tTranslator({ type: 'test' })
    expect(result.status).toBe('error')
  })

  it('errors when no Logical Device declares cq18t-control', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    const result = await cq18tTranslator({ type: 'test' })
    expect(result.status).toBe('error')
    expect(sendNrpn).not.toHaveBeenCalled()
  })

  it('errors when no DeviceTransportConfig is set up for this tablet', async () => {
    useDeviceTransportConfigStore.setState({ configs: [] })
    const result = await cq18tTranslator({ type: 'test' })
    expect(result.status).toBe('error')
  })

  it('errors on an unknown event type', async () => {
    const result = await cq18tTranslator({ type: 'something.else' })
    expect(result.status).toBe('error')
    expect(sendNrpn).not.toHaveBeenCalled()
  })

  describe('cq18t.setLevel', () => {
    it('sends the input-to-Main-LR NRPN address with the dB value interpolated to raw14', async () => {
      const result = await cq18tTranslator({ type: 'cq18t.setLevel', payload: { channel: 1, db: 0 } })
      expect(result.status).toBe('ok')
      // Ip1 -> Main LR = (0x40, 0x00); 0dB = raw 0x3100 = MSB 0x62, LSB 0x00.
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x40, 0x00, 0x62, 0x00)
    })

    it('offsets the address LSB by channel number', async () => {
      await cq18tTranslator({ type: 'cq18t.setLevel', payload: { channel: 5, db: 0 } })
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x40, 0x04, 0x62, 0x00) // Ip5 -> LSB 0x04
    })

    it('clamps to the documented curve range', async () => {
      await cq18tTranslator({ type: 'cq18t.setLevel', payload: { channel: 1, db: 999 } })
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x40, 0x00, 0x7f, 0x40) // +10dB max = raw 0x3fc0
    })

    it('rejects an out-of-range channel', async () => {
      const result = await cq18tTranslator({ type: 'cq18t.setLevel', payload: { channel: 17, db: 0 } })
      expect(result.status).toBe('error')
      expect(sendNrpn).not.toHaveBeenCalled()
    })
  })

  describe('cq18t.setMute', () => {
    it('mutes an input channel', async () => {
      const result = await cq18tTranslator({ type: 'cq18t.setMute', payload: { channel: 1, muted: true } })
      expect(result.status).toBe('ok')
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x00, 0x00, 0x00, 0x01)
    })

    it('unmutes', async () => {
      await cq18tTranslator({ type: 'cq18t.setMute', payload: { channel: 1, muted: false } })
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x00, 0x00, 0x00, 0x00)
    })

    it('targets the Main LR mute address for "main"', async () => {
      await cq18tTranslator({ type: 'cq18t.setMute', payload: { channel: 'main', muted: true } })
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x00, 0x44, 0x00, 0x01)
    })

    it('rejects an out-of-range channel', async () => {
      const result = await cq18tTranslator({ type: 'cq18t.setMute', payload: { channel: 99, muted: true } })
      expect(result.status).toBe('error')
      expect(sendNrpn).not.toHaveBeenCalled()
    })
  })

  describe('test', () => {
    it('sends a read-only NRPN Get on Ip1 mute, never a set', async () => {
      const result = await cq18tTranslator({ type: 'test' })
      expect(result.status).toBe('ok')
      // The placeholder addressing call (harmless, no data change) plus the real CC96=0x7F Get.
      expect(sendNrpn).toHaveBeenCalledWith(OUTPUT, 0, 0x00, 0x00, 0, 0)
      expect(send).toHaveBeenCalledWith([0xb0, 96, 0x7f])
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceTransportConfig, LogicalDevice } from 'shared-types'

vi.mock('./webMidiOutput', () => ({
  getMidiOutputById: vi.fn(),
  sendSysEx: vi.fn(),
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

const { getMidiOutputById, sendSysEx } = await import('./webMidiOutput')
const { MG30_CAPABILITY, mg30Translator } = await import('./mg30Translator')
const { getDeviceId } = await import('./deviceId')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

const LOGICAL_DEVICE: LogicalDevice = {
  id: 'mg30-1',
  name: 'Marcos MG-30',
  capability: MG30_CAPABILITY,
  pluginId: null,
  executionTarget: null,
}
const send = vi.fn()
const OUTPUT = { id: 'midi-out-1', send } as unknown as MIDIOutput

function configWith(values: Record<string, string>): DeviceTransportConfig {
  return { id: `${getDeviceId()}:mg30-1`, deviceId: getDeviceId(), logicalDeviceId: 'mg30-1', transportId: 'usb-midi', values }
}

beforeEach(() => {
  vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs: new Map(), outputs: new Map() }) })
  vi.mocked(getMidiOutputById).mockReset().mockResolvedValue(OUTPUT)
  vi.mocked(sendSysEx).mockReset()
  send.mockReset()
  useLogicalDevicesStore.setState({ devices: [LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '1' })], loaded: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mg30Translator', () => {
  it('errors when no Logical Device declares mg30-control', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    const result = await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 0 } })
    expect(result.status).toBe('error')
  })

  it('errors when no DeviceTransportConfig is set up for this tablet', async () => {
    useDeviceTransportConfigStore.setState({ configs: [] })
    const result = await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 0 } })
    expect(result.status).toBe('error')
  })

  it('errors on an unknown event type', async () => {
    const result = await mg30Translator({ type: 'something.else' })
    expect(result.status).toBe('error')
  })

  describe('mg30.selectPatch', () => {
    it('sends a Program Change and derives the bank/letter patch name', async () => {
      const result = await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 5 } })
      expect(result.status).toBe('ok')
      expect(send).toHaveBeenCalledWith([0xc0, 5])
      expect(result.data).toEqual({ program: 5, patchName: '02B' }) // bank=(5//4)+1=2, letter=ABCD[5%4]=B
    })

    it('program 0 -> 01A, program 127 -> 32D', async () => {
      await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 0 } })
      expect((await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 0 } })).data).toEqual({ program: 0, patchName: '01A' })
      expect((await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 127 } })).data).toEqual({ program: 127, patchName: '32D' })
    })

    it('uses the configured MIDI channel', async () => {
      useDeviceTransportConfigStore.setState({ configs: [configWith({ midiOutputId: 'midi-out-1', midiChannel: '4' })] })
      await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 0 } })
      expect(send).toHaveBeenCalledWith([0xc3, 0]) // channel 4 -> 0-indexed 3
    })

    it('rejects an out-of-range program', async () => {
      const result = await mg30Translator({ type: 'mg30.selectPatch', payload: { program: 128 } })
      expect(result.status).toBe('error')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('mg30.setKnob', () => {
    it('sends a plain CC within the documented knob range', async () => {
      const result = await mg30Translator({ type: 'mg30.setKnob', payload: { cc: 30, value: 64 } })
      expect(result.status).toBe('ok')
      expect(send).toHaveBeenCalledWith([0xb0, 30, 64])
    })

    it('rejects a CC outside 11-74 (the block-toggle range is deliberately not exposed)', async () => {
      const result = await mg30Translator({ type: 'mg30.setKnob', payload: { cc: 5, value: 1 } })
      expect(result.status).toBe('error')
      expect(send).not.toHaveBeenCalled()
    })

    it('rejects an out-of-range value', async () => {
      const result = await mg30Translator({ type: 'mg30.setKnob', payload: { cc: 30, value: 200 } })
      expect(result.status).toBe('error')
    })
  })

  describe('test', () => {
    it('sends the identity request and reports the decoded firmware version from a real reply', async () => {
      const listeners: ((event: { data: Uint8Array }) => void)[] = []
      const input = {
        name: 'NUX MG-30 Emulator',
        manufacturer: '',
        addEventListener: (_type: string, handler: (event: { data: Uint8Array }) => void) => listeners.push(handler),
        removeEventListener: vi.fn(),
      }
      vi.stubGlobal('navigator', {
        requestMIDIAccess: vi.fn().mockResolvedValue({ inputs: new Map([['in-1', input]]), outputs: new Map() }),
      })

      const resultPromise = mg30Translator({ type: 'test' })
      // Give waitForSysExReply's own requestMIDIAccess a tick to resolve and attach the listener.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(sendSysEx).toHaveBeenCalledWith(OUTPUT, [0x43, 0x58, 0x00])

      const reply = new Uint8Array([0xf0, 0x43, 0x58, 0x10, 0x76, 0x34, 0x2e, 0x30, 0x2e, 0x33, 0xf7]) // "v4.0.3"
      listeners.forEach((handler) => handler({ data: reply }))

      const result = await resultPromise
      expect(result.status).toBe('ok')
      expect(result.message).toContain('v4.0.3')
    })

    it('attaches the midimessage listener before sending the identity request - real hardware over USB-MIDI can reply fast enough that the reverse order silently misses it (found live, 2026-09-08)', async () => {
      const order: string[] = []
      const input = {
        name: 'NUX MG-30',
        manufacturer: 'NUX',
        addEventListener: () => order.push('listen'),
        removeEventListener: vi.fn(),
      }
      vi.stubGlobal('navigator', {
        requestMIDIAccess: vi.fn().mockResolvedValue({ inputs: new Map([['in-1', input]]), outputs: new Map() }),
      })
      vi.mocked(sendSysEx).mockImplementation(() => order.push('send'))

      await mg30Translator({ type: 'test' })

      expect(order).toEqual(['listen', 'send'])
    })

    it('catches a reply that arrives synchronously, immediately on send (real-hardware timing)', async () => {
      let handler: ((event: { data: Uint8Array }) => void) | null = null
      const reply = new Uint8Array([0xf0, 0x43, 0x58, 0x10, 0x76, 0x35, 0x2e, 0x30, 0x2e, 0x32, 0xf7]) // "v5.0.2"
      const input = {
        name: 'NUX MG-30',
        manufacturer: 'NUX',
        addEventListener: (_type: string, h: (event: { data: Uint8Array }) => void) => {
          handler = h
        },
        removeEventListener: vi.fn(),
      }
      vi.stubGlobal('navigator', {
        requestMIDIAccess: vi.fn().mockResolvedValue({ inputs: new Map([['in-1', input]]), outputs: new Map() }),
      })
      // Simulates a real device replying the instant the request is sent, before `send()` even
      // returns - only possible to catch at all if the listener was attached first.
      vi.mocked(sendSysEx).mockImplementation(() => handler?.({ data: reply }))

      const result = await mg30Translator({ type: 'test' })

      expect(result.status).toBe('ok')
      expect(result.message).toContain('v5.0.2')
    })

    it('errors when no reply arrives within the timeout', async () => {
      vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs: new Map(), outputs: new Map() }) })
      const result = await mg30Translator({ type: 'test' })
      expect(result.status).toBe('error')
    }, 2000)
  })
})

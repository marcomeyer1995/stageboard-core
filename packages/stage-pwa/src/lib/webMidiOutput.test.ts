import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendControlChange, sendNrpn, sendSysEx } from './webMidiOutput'

const KEMPER_TRIGGER = [
  { cc: 31, value: 127 },
  { cc: 31, value: 0 },
]

// getMidiOutputById caches the MIDIAccess promise at module scope (webMidiOutput.ts), so each
// test needs a fresh module instance - vi.resetModules() + a fresh dynamic import, same reason
// clientPluginModule-adjacent tests avoid relying on import-time singletons across tests.
async function freshModule() {
  vi.resetModules()
  return import('./webMidiOutput')
}

describe('getMidiOutputById', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null when WebMIDI is unsupported', async () => {
    vi.stubGlobal('navigator', {})
    const { getMidiOutputById: fresh } = await freshModule()
    expect(await fresh('out-1')).toBeNull()
  })

  it('is null when requestMIDIAccess rejects (denied permission)', async () => {
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockRejectedValue(new Error('denied')) })
    const { getMidiOutputById: fresh } = await freshModule()
    expect(await fresh('out-1')).toBeNull()
  })

  it('resolves an output by id, and null for an id that is not connected', async () => {
    const output = { id: 'out-1' }
    const outputs = new Map([['out-1', output]])
    const requestMIDIAccess = vi.fn().mockResolvedValue({ outputs })
    vi.stubGlobal('navigator', { requestMIDIAccess })
    const { getMidiOutputById: fresh } = await freshModule()

    expect(await fresh('out-1')).toBe(output)
    expect(await fresh('missing')).toBeNull()
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1) // cached across calls
  })
})

describe('findMidiOutputIdByNamePattern', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null when WebMIDI is unsupported', async () => {
    vi.stubGlobal('navigator', {})
    const { findMidiOutputIdByNamePattern: fresh } = await freshModule()
    expect(await fresh('Kemper')).toBeNull()
  })

  it('finds an output by a case-insensitive name substring', async () => {
    const outputs = new Map([
      ['out-1', { id: 'out-1', name: 'Midi Through Port-0', manufacturer: '' }],
      ['out-2', { id: 'out-2', name: 'RtMidiOut Client:Kemper Profiler Emulator 129:0', manufacturer: '' }],
    ])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ outputs }) })
    const { findMidiOutputIdByNamePattern: fresh } = await freshModule()
    expect(await fresh('kemper')).toBe('out-2')
  })

  it('falls back to matching manufacturer when the name does not match', async () => {
    const outputs = new Map([['out-1', { id: 'out-1', name: 'Some Port', manufacturer: 'Kemper' }]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ outputs }) })
    const { findMidiOutputIdByNamePattern: fresh } = await freshModule()
    expect(await fresh('Kemper')).toBe('out-1')
  })

  it('is null when nothing matches', async () => {
    const outputs = new Map([['out-1', { id: 'out-1', name: 'RC-500', manufacturer: '' }]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ outputs }) })
    const { findMidiOutputIdByNamePattern: fresh } = await freshModule()
    expect(await fresh('Kemper')).toBeNull()
  })
})

describe('sendControlChange', () => {
  it('packs status/channel, cc, and value into a 3-byte CC message', () => {
    const send = vi.fn()
    sendControlChange({ send } as unknown as MIDIOutput, 0, 47, 12)
    expect(send).toHaveBeenCalledWith([0xb0, 47, 12])
  })

  it('packs a non-zero channel into the low nibble of the status byte', () => {
    const send = vi.fn()
    sendControlChange({ send } as unknown as MIDIOutput, 3, 50, 127)
    expect(send).toHaveBeenCalledWith([0xb3, 50, 127])
  })
})

describe('sendCcSequence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('is false when no output matches the name pattern', async () => {
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ outputs: new Map() }) })
    const { sendCcSequence: fresh } = await freshModule()
    expect(await fresh('Kemper', KEMPER_TRIGGER)).toBe(false)
  })

  it('sends every step of the sequence, in order, to the matched output', async () => {
    const send = vi.fn()
    const outputs = new Map([['out-1', { id: 'out-1', name: 'Kemper Profiler Emulator', manufacturer: '', send }]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ outputs }) })
    const { sendCcSequence: fresh } = await freshModule()

    vi.useFakeTimers()
    const result = fresh('Kemper', KEMPER_TRIGGER)
    await vi.advanceTimersByTimeAsync(500) // past the inter-step gap for both steps
    expect(await result).toBe(true)

    expect(send).toHaveBeenNthCalledWith(1, [0xb0, 31, 127])
    expect(send).toHaveBeenNthCalledWith(2, [0xb0, 31, 0])
  })
})

describe('sendNrpn', () => {
  it('sends the 4-message NRPN sequence in order: address MSB/LSB, then data MSB/LSB', () => {
    const send = vi.fn()
    sendNrpn({ send } as unknown as MIDIOutput, 0, 0x40, 0x02, 0x62, 0x00)
    expect(send).toHaveBeenNthCalledWith(1, [0xb0, 99, 0x40])
    expect(send).toHaveBeenNthCalledWith(2, [0xb0, 98, 0x02])
    expect(send).toHaveBeenNthCalledWith(3, [0xb0, 6, 0x62])
    expect(send).toHaveBeenNthCalledWith(4, [0xb0, 38, 0x00])
  })

  it('packs a non-zero channel into every message of the sequence', () => {
    const send = vi.fn()
    sendNrpn({ send } as unknown as MIDIOutput, 3, 0x00, 0x44, 0x00, 0x01)
    expect(send).toHaveBeenNthCalledWith(1, [0xb3, 99, 0x00])
    expect(send).toHaveBeenNthCalledWith(4, [0xb3, 38, 0x01])
  })
})

describe('sendSysEx', () => {
  it('wraps the payload in F0/F7 framing', () => {
    const send = vi.fn()
    sendSysEx({ send } as unknown as MIDIOutput, [0x43, 0x58, 0x00])
    expect(send).toHaveBeenCalledWith([0xf0, 0x43, 0x58, 0x00, 0xf7])
  })
})

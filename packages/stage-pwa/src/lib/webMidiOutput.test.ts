import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendControlChange } from './webMidiOutput'

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

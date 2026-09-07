import { afterEach, describe, expect, it, vi } from 'vitest'
import { listenToPortByHardwareKey } from './webMidi'

function fakeInput(id: string, name: string) {
  return { id, name, manufacturer: '', addEventListener: vi.fn(), removeEventListener: vi.fn() }
}

describe('listenToPortByHardwareKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is null when WebMIDI is unsupported', async () => {
    vi.stubGlobal('navigator', {})
    expect(await listenToPortByHardwareKey('webmidi:some-id', vi.fn())).toBeNull()
  })

  it('is null when no connected input matches the hardwareKey', async () => {
    const inputs = new Map([['in-1', fakeInput('in-1', 'Some Controller')]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs }) })
    expect(await listenToPortByHardwareKey('webmidi:not-connected', vi.fn())).toBeNull()
  })

  it('attaches a midimessage listener to the matching input and forwards its data', async () => {
    const input = fakeInput('in-1', 'Kemper Profiler Emulator')
    const inputs = new Map([['in-1', input]])
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue({ inputs }) })

    // shared-types' hardwareKeyFor hashes name+manufacturer+portId together - rather than
    // reimplementing that hash here, discover it the same way the module under test does: read
    // back whatever key it actually expects by calling with the input's own id first and
    // widening the search isn't possible, so import the same helper the module uses.
    const { hardwareKeyFor } = await import('shared-types')
    const key = hardwareKeyFor({ kind: 'webmidi', portId: 'in-1', name: 'Kemper Profiler Emulator', manufacturer: '' })

    const onMessage = vi.fn()
    const stop = await listenToPortByHardwareKey(key, onMessage)
    expect(stop).not.toBeNull()
    expect(input.addEventListener).toHaveBeenCalledWith('midimessage', expect.any(Function))

    const handler = input.addEventListener.mock.calls[0][1]
    const data = new Uint8Array([0xb0, 31, 127])
    handler({ data })
    expect(onMessage).toHaveBeenCalledWith(data)

    stop?.()
    expect(input.removeEventListener).toHaveBeenCalledWith('midimessage', handler)
  })
})

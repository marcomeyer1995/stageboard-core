import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A stand-in for RtMidi: one machine with ports, what was sent, and when an input was opened compared to a send. */
const machine = { outputs: ['MG-30:MG-30 MIDI 1 24:0'], inputs: ['MG-30:MG-30 MIDI 1 24:0'], events: [] as string[], failSend: false, unavailable: false }
const inputs: FakeInput[] = []

class FakePort {
  constructor() {
    if (machine.unavailable) throw new Error('ALSA: cannot open /dev/snd/seq')
  }
  destroy() {}
  closePort() {}
}
class FakeOutput extends FakePort {
  getPortCount = () => machine.outputs.length
  getPortName = (i: number) => machine.outputs[i]!
  openPort(i: number) {
    machine.events.push(`open-out ${i}`)
  }
  sendMessage(bytes: number[]) {
    if (machine.failSend) throw new Error('port gone')
    machine.events.push(`send ${bytes.join(',')}`)
  }
}
class FakeInput extends FakePort {
  listener: ((delta: number, message: number[]) => void) | null = null
  ignored: boolean[] = [true, true, true]
  constructor() {
    super()
    inputs.push(this)
  }
  getPortCount = () => machine.inputs.length
  getPortName = (i: number) => machine.inputs[i]!
  ignoreTypes(sysex: boolean, timing: boolean, sensing: boolean) {
    this.ignored = [sysex, timing, sensing]
  }
  on(_event: string, listener: (delta: number, message: number[]) => void) {
    this.listener = listener
  }
  openPort(i: number) {
    machine.events.push(`open-in ${i}`)
  }
}
vi.mock('@julusian/midi', () => ({ Input: FakeInput, Output: FakeOutput }))

const { createNativeMidi, inputFor } = await import('./nativeMidi.js')

beforeEach(() => {
  machine.outputs = ['MG-30:MG-30 MIDI 1 24:0']
  machine.inputs = ['MG-30:MG-30 MIDI 1 24:0']
  machine.events = []
  machine.failSend = false
  machine.unavailable = false
  inputs.length = 0
})

describe('this machine\'s MIDI ports (#964)', () => {
  it('finds the input of the same device: the same name, else the same client', () => {
    expect(inputFor('MG-30:MG-30 MIDI 1 24:0', ['Through', 'MG-30:MG-30 MIDI 1 24:0'])).toBe(1)
    expect(inputFor('MG-30:MG-30 MIDI 1 24:0', ['Through', 'MG-30:MG-30 Input 24:1'])).toBe(1)
    expect(inputFor('MG-30:MG-30 MIDI 1 24:0', ['Through'])).toBe(-1)
    // A virtual device (the emulators): the same port name under another client and another address.
    expect(inputFor('RtMidiIn Client:NUX MG-30 Emulator 128:0', ['Midi Through:Midi Through Port-0 14:0', 'RtMidiOut Client:NUX MG-30 Emulator 129:0'])).toBe(1)
  })

  it('opens the named output for each message, so a device plugged in again is reached (an output kept open would still point at the old one)', () => {
    const midi = createNativeMidi()
    expect(midi.send('MG-30:MG-30 MIDI 1 24:0', [0xc0, 3])).toBe(true)
    expect(midi.send('MG-30:MG-30 MIDI 1 24:0', [0xc0, 4])).toBe(true)
    expect(machine.events).toEqual(['open-out 0', 'send 192,3', 'open-out 0', 'send 192,4'])
    expect(midi.send('Other', [0xc0, 4])).toBe(false)
  })

  it('a send that fails is false, and the next one opens the port again', () => {
    const midi = createNativeMidi()
    machine.failSend = true
    expect(midi.send('MG-30:MG-30 MIDI 1 24:0', [2])).toBe(false)
    machine.failSend = false
    expect(midi.send('MG-30:MG-30 MIDI 1 24:0', [3])).toBe(true)
  })

  it('listens before it sends, takes SysEx, and answers the first message with the prefix', async () => {
    const midi = createNativeMidi()
    const answer = midi.sendAndWait('MG-30:MG-30 MIDI 1 24:0', [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7], [0xf0, 0x7e], 1000)
    const input = inputs.at(-1)!
    expect(machine.events.indexOf('open-in 0')).toBeLessThan(machine.events.findIndex((e) => e.startsWith('send')))
    expect(input.ignored[0]).toBe(false)
    input.listener!(0, [0xb0, 1, 2])
    input.listener!(0, [0xf0, 0x7e, 0x00, 0x06, 0x02, 0xf7])
    expect(await answer).toEqual([0xf0, 0x7e, 0x00, 0x06, 0x02, 0xf7])
  })

  it('answers null when no reply comes in time, undefined when there is no such output', async () => {
    const midi = createNativeMidi()
    expect(await midi.sendAndWait('MG-30:MG-30 MIDI 1 24:0', [0xf0, 0xf7], [0xf0], 10)).toBeNull()
    expect(await midi.sendAndWait('Unplugged', [0xf0, 0xf7], [0xf0], 10)).toBeUndefined()
  })

  it('keeps running without MIDI: no ports, no listener, and the outage is logged once', () => {
    machine.unavailable = true
    const log = { info: vi.fn(), error: vi.fn() }
    const midi = createNativeMidi(log)
    expect(midi.outputs()).toBeNull()
    expect(midi.inputs()).toBeNull()
    expect(midi.send('MG-30:MG-30 MIDI 1 24:0', [1])).toBe(false)
    expect(midi.listen('MG-30:MG-30 MIDI 1 24:0', () => {})).toBeNull()
    expect(log.error).toHaveBeenCalledTimes(1)
    machine.unavailable = false
    expect(midi.inputs()).toEqual(['MG-30:MG-30 MIDI 1 24:0'])
    expect(log.info).toHaveBeenCalledWith('Native MIDI available again')
  })
})

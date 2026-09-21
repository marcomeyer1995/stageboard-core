import { describe, expect, it } from 'vitest'
import { createCueRecording } from './cueRecording'
import { createMidiDecoder } from './midiCueDecoders'
import { MG30_CAPABILITY, RC500_CAPABILITY } from './midiDeviceProtocols'

const PC = (program: number) => [0xc0, program]
const CC = (cc: number, value: number) => [0xb0, cc, value]

describe('createCueRecording', () => {
  it('records each decodable message at the song position it arrived at', () => {
    const recording = createCueRecording(createMidiDecoder(RC500_CAPABILITY, 0)!)
    recording.handle(PC(4), 12_340.6)
    recording.handle(PC(9), 47_000)

    expect(recording.recorded()).toEqual([
      { timeMs: 12_341, event: { type: 'rc500.selectMemory', payload: { memory: 5 } } },
      { timeMs: 47_000, event: { type: 'rc500.selectMemory', payload: { memory: 10 } } },
    ])
  })

  it('counts what it cannot decode instead of recording it', () => {
    const recording = createCueRecording(createMidiDecoder(RC500_CAPABILITY, 0)!)
    expect(recording.handle([0xf8], 100)).toBeNull()
    expect(recording.handle(CC(20, 127), 200)).toBeNull()
    recording.handle(PC(1), 300)

    expect(recording.ignoredCount()).toBe(2)
    expect(recording.recorded()).toHaveLength(1)
  })

  it('collapses a knob sweep into one cue at the end of the gesture with its final value', () => {
    const recording = createCueRecording(createMidiDecoder(MG30_CAPABILITY, 0)!)
    for (let step = 0; step < 20; step++) recording.handle(CC(30, step * 5), 1000 + step * 50)

    expect(recording.recorded()).toEqual([{ timeMs: 1950, event: { type: 'mg30.setKnob', payload: { cc: 30, value: 95 } } }])
  })

  it('starts a new cue once the knob has rested, and keeps different knobs apart', () => {
    const recording = createCueRecording(createMidiDecoder(MG30_CAPABILITY, 0)!)
    recording.handle(CC(30, 10), 1000)
    recording.handle(CC(31, 50), 1100)
    recording.handle(CC(30, 90), 5000) // long after the first gesture

    expect(recording.recorded().map((cue) => [cue.timeMs, cue.event.payload])).toEqual([
      [1000, { cc: 30, value: 10 }],
      [1100, { cc: 31, value: 50 }],
      [5000, { cc: 30, value: 90 }],
    ])
  })

  it('never records a negative position', () => {
    const recording = createCueRecording(createMidiDecoder(RC500_CAPABILITY, 0)!)
    recording.handle(PC(0), -50)
    expect(recording.recorded()[0].timeMs).toBe(0)
  })

  it('builds ShowCues for the chosen Logical Device', () => {
    const recording = createCueRecording(createMidiDecoder(RC500_CAPABILITY, 0)!)
    recording.handle(PC(2), 8000)
    let counter = 0

    expect(recording.toShowCues('device-1', () => `cue-${++counter}`)).toEqual([
      { id: 'cue-1', timeMs: 8000, targetLogicalDeviceId: 'device-1', type: 'rc500.selectMemory', payload: { memory: 3 } },
    ])
  })
})

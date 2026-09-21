import { describe, expect, it } from 'vitest'
import { canDecodeCapability, createMidiDecoder } from './midiCueDecoders'
import { KEMPER_CAPABILITY, KEMPER_CC, KEMPER_STOMP_CC, MG30_CAPABILITY, RC500_CAPABILITY } from './midiDeviceProtocols'

const CC = (channel: number, cc: number, value: number) => [0xb0 | channel, cc, value]
const PC = (channel: number, program: number) => [0xc0 | channel, program]

describe('Kemper decoder', () => {
  it('turns a performance preselect plus a slot press into one rig change', () => {
    const decoder = createMidiDecoder(KEMPER_CAPABILITY, 0)!
    expect(decoder.decode(CC(0, KEMPER_CC.performancePreselect, 12))).toBeNull() // half a rig change
    expect(decoder.decode(CC(0, KEMPER_CC.slot[2], 127))).toEqual({
      type: 'kemper.selectRig',
      payload: { performance: 12, slot: 3 },
    })
  })

  it('remembers the performance for later slot changes, and ignores a slot with none known', () => {
    const decoder = createMidiDecoder(KEMPER_CAPABILITY, null)!
    expect(decoder.decode(CC(0, KEMPER_CC.slot[0], 127))).toBeNull()
    decoder.decode(CC(0, KEMPER_CC.performancePreselect, 4))
    decoder.decode(CC(0, KEMPER_CC.slot[0], 127))
    expect(decoder.decode(CC(0, KEMPER_CC.slot[4], 127))).toEqual({
      type: 'kemper.selectRig',
      payload: { performance: 4, slot: 5 },
    })
  })

  it('reads stomp presses, with the tail variants', () => {
    const decoder = createMidiDecoder(KEMPER_CAPABILITY, 0)!
    expect(decoder.decode(CC(0, KEMPER_STOMP_CC.A, 127))).toEqual({ type: 'kemper.stomp', payload: { stomp: 'A' } })
    expect(decoder.decode(CC(0, 27, 127))).toEqual({ type: 'kemper.stomp', payload: { stomp: 'DELAY', tail: true } })
  })

  it('ignores a stomp release (value 0)', () => {
    expect(createMidiDecoder(KEMPER_CAPABILITY, 0)!.decode(CC(0, KEMPER_STOMP_CC.A, 0))).toBeNull()
  })
})

describe('RC-500 decoder', () => {
  it('maps Program Change to the 1-based memory', () => {
    const decoder = createMidiDecoder(RC500_CAPABILITY, 0)!
    expect(decoder.decode(PC(0, 0))).toEqual({ type: 'rc500.selectMemory', payload: { memory: 1 } })
    expect(decoder.decode(PC(0, 98))).toEqual({ type: 'rc500.selectMemory', payload: { memory: 99 } })
  })

  it('ignores a program beyond the 99 memories and any CC (its CCs are per-memory assignments)', () => {
    const decoder = createMidiDecoder(RC500_CAPABILITY, 0)!
    expect(decoder.decode(PC(0, 99))).toBeNull()
    expect(decoder.decode(CC(0, 20, 127))).toBeNull()
  })
})

describe('MG-30 decoder', () => {
  it('maps Program Change to a patch and a knob CC to setKnob', () => {
    const decoder = createMidiDecoder(MG30_CAPABILITY, 0)!
    expect(decoder.decode(PC(0, 7))).toEqual({ type: 'mg30.selectPatch', payload: { program: 7 } })
    expect(decoder.decode(CC(0, 30, 64))).toEqual({ type: 'mg30.setKnob', payload: { cc: 30, value: 64 } })
  })

  it('ignores CCs outside the knob range', () => {
    expect(createMidiDecoder(MG30_CAPABILITY, 0)!.decode(CC(0, 5, 64))).toBeNull()
    expect(createMidiDecoder(MG30_CAPABILITY, 0)!.decode(CC(0, 75, 64))).toBeNull()
  })
})

describe('shared rules', () => {
  it('only reads the configured channel, or every channel when none is set', () => {
    expect(createMidiDecoder(RC500_CAPABILITY, 2)!.decode(PC(0, 5))).toBeNull()
    expect(createMidiDecoder(RC500_CAPABILITY, 2)!.decode(PC(2, 5))).not.toBeNull()
    expect(createMidiDecoder(RC500_CAPABILITY, null)!.decode(PC(9, 5))).not.toBeNull()
  })

  it('never turns system messages (clock, active sensing, SysEx) into cues', () => {
    const decoder = createMidiDecoder(MG30_CAPABILITY, null)!
    expect(decoder.decode([0xf8])).toBeNull()
    expect(decoder.decode([0xfe])).toBeNull()
    expect(decoder.decode([0xf0, 0x43, 0x58, 0x10, 0xf7])).toBeNull()
    expect(decoder.decode([])).toBeNull()
  })

  it('offers only capabilities that have a decoder', () => {
    expect(canDecodeCapability(KEMPER_CAPABILITY)).toBe(true)
    expect(canDecodeCapability('cq18t-control')).toBe(false)
    expect(createMidiDecoder('cq18t-control', 0)).toBeNull()
  })
})

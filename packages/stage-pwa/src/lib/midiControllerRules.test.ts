import { describe, expect, it } from 'vitest'
import { decodeMidiButton, describeMidiTrigger, matchMidiRule, triggerFromEvent, type MidiControllerRule } from './midiControllerRules'

const behavior = { kind: 'momentary' as const, press: { kind: 'show' as const, op: 'next' as const }, release: { kind: 'none' as const } }
const rule = (id: string, trigger: MidiControllerRule['trigger']): MidiControllerRule => ({ id, trigger, behavior })

describe('MIDI controller buttons (#547 step 2)', () => {
  it('decodes notes, CC and program changes as press/release - and nothing else', () => {
    expect(decodeMidiButton([0x90, 36, 100])).toEqual({ message: 'note', channel: 1, number: 36, value: 100, edge: 'press' })
    expect(decodeMidiButton([0x90, 36, 0])?.edge).toBe('release') // Note On velocity 0
    expect(decodeMidiButton([0x81, 36, 64])).toEqual({ message: 'note', channel: 2, number: 36, value: 0, edge: 'release' })
    expect(decodeMidiButton([0xb0, 64, 127])?.edge).toBe('press')
    expect(decodeMidiButton([0xb0, 64, 0])?.edge).toBe('release')
    expect(decodeMidiButton([0xcf, 5])).toEqual({ message: 'program', channel: 16, number: 5, value: 0, edge: 'press' })
    expect(decodeMidiButton([0xf8])).toBeNull() // MIDI clock
  })

  it('matches by kind, channel and number; a CC rule with a value only presses on that value', () => {
    const rules = [rule('a', { message: 'note', channel: 1, number: 36 }), rule('b', { message: 'cc', channel: 1, number: 80, value: 127 }), rule('c', { message: 'cc', channel: 1, number: 80, value: 0 })]
    expect(matchMidiRule(rules, decodeMidiButton([0x90, 36, 90])!)).toMatchObject({ rule: { id: 'a' }, edge: 'press' })
    expect(matchMidiRule(rules, decodeMidiButton([0x80, 36, 0])!)).toMatchObject({ rule: { id: 'a' }, edge: 'release' })
    expect(matchMidiRule(rules, decodeMidiButton([0x91, 36, 90])!)).toBeNull() // other channel
    expect(matchMidiRule(rules, decodeMidiButton([0xb0, 80, 127])!)).toMatchObject({ rule: { id: 'b' }, edge: 'press' })
    expect(matchMidiRule(rules, decodeMidiButton([0xb0, 80, 0])!)).toMatchObject({ rule: { id: 'c' }, edge: 'press' })
    expect(matchMidiRule(rules, decodeMidiButton([0xb0, 80, 64])!)).toBeNull()
  })

  it('learns a CC with its value unless it is the usual 127', () => {
    expect(triggerFromEvent(decodeMidiButton([0xb0, 80, 127])!)).toEqual({ message: 'cc', channel: 1, number: 80 })
    expect(triggerFromEvent(decodeMidiButton([0xb0, 80, 1])!)).toEqual({ message: 'cc', channel: 1, number: 80, value: 1 })
    expect(describeMidiTrigger({ message: 'cc', channel: 1, number: 80, value: 1 })).toBe('CC 80 = 1 · Kanal 1')
  })
})

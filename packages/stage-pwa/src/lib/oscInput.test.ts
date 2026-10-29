import { describe, expect, it } from 'vitest'
import { describeOscTrigger, matchOscRule, oscEdge, oscTriggerFrom, sameOscTrigger, type OscInputRule } from './oscInput'

const rule = (id: string, address: string, value?: number): OscInputRule => ({ id, trigger: value === undefined ? { address } : { address, value }, behavior: { kind: 'momentary', press: { kind: 'show', op: 'play-pause' }, release: { kind: 'none' } } as never })

describe('OSC as a trigger (#484)', () => {
  it('presses on a value above 0, true or no value; lets go on 0 or false', () => {
    expect(oscEdge({ args: [1] })).toBe('press')
    expect(oscEdge({ args: [0.5] })).toBe('press')
    expect(oscEdge({ args: [0] })).toBe('release')
    expect(oscEdge({ args: [true] })).toBe('press')
    expect(oscEdge({ args: [false] })).toBe('release')
    expect(oscEdge({ args: [] })).toBe('press')
    expect(oscEdge({ args: ['go'] })).toBe('press')
  })

  it('matches by address; a rule with a value only presses on exactly that value', () => {
    const rules = [rule('a', '/1/push1'), rule('s3', '/scene', 3)]
    expect(matchOscRule(rules, { address: '/1/push1', args: [1] })).toMatchObject({ rule: { id: 'a' }, edge: 'press' })
    expect(matchOscRule(rules, { address: '/1/push1', args: [0] })).toMatchObject({ rule: { id: 'a' }, edge: 'release' })
    expect(matchOscRule(rules, { address: '/scene', args: [3] })).toMatchObject({ rule: { id: 's3' }, edge: 'press' })
    expect(matchOscRule(rules, { address: '/scene', args: [2] })).toBeNull()
    expect(matchOscRule(rules, { address: '/other', args: [1] })).toBeNull()
  })

  it('learns a button: a plain 1/0 button by its address, a value button with its value', () => {
    expect(oscTriggerFrom({ address: '/1/push1', args: [1] })).toEqual({ address: '/1/push1' })
    expect(oscTriggerFrom({ address: '/scene', args: [4] })).toEqual({ address: '/scene', value: 4 })
    expect(oscTriggerFrom({ address: '/go', args: [] })).toEqual({ address: '/go' })
    expect(sameOscTrigger({ address: '/a' }, { address: '/a' })).toBe(true)
    expect(sameOscTrigger({ address: '/a', value: 1 }, { address: '/a' })).toBe(false)
    expect(describeOscTrigger({ address: '/scene', value: 4 })).toBe('/scene = 4')
  })
})

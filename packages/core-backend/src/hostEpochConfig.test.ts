import { describe, expect, it } from 'vitest'
import { configuredHostEpoch } from './hostEpochConfig.js'

describe('configuredHostEpoch (host backup test setting)', () => {
  it('is 1 without the variable', () => {
    expect(configuredHostEpoch({})).toBe(1)
  })

  it('takes a whole number of 1 or more', () => {
    expect(configuredHostEpoch({ STAGEBOARD_HOST_EPOCH: '3' })).toBe(3)
    expect(configuredHostEpoch({ STAGEBOARD_HOST_EPOCH: ' 2 ' })).toBe(2)
  })

  it('falls back to 1 for 0, negative, a fraction, text or empty', () => {
    for (const bad of ['0', '-2', '1.5', 'two', '', '3x']) {
      expect(configuredHostEpoch({ STAGEBOARD_HOST_EPOCH: bad })).toBe(1)
    }
  })
})

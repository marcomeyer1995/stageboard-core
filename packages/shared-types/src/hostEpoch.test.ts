import { describe, expect, it } from 'vitest'
import { HostTimeAnswerSchema, HostTimeSchema } from './hostEpoch.js'

describe('HostTimeSchema (#910)', () => {
  it('accepts serverTime, hostId and an epoch of 1 or more', () => {
    expect(HostTimeSchema.safeParse({ serverTime: 1700000000000, hostId: 'laptop', epoch: 1 }).success).toBe(true)
    expect(HostTimeSchema.safeParse({ serverTime: 1700000000000, hostId: 'laptop', epoch: 7 }).success).toBe(true)
  })

  it('rejects an epoch below 1, a fraction, or an empty host id', () => {
    for (const epoch of [0, -1, 1.5]) {
      expect(HostTimeSchema.safeParse({ serverTime: 1, hostId: 'laptop', epoch }).success).toBe(false)
    }
    expect(HostTimeSchema.safeParse({ serverTime: 1, hostId: '', epoch: 1 }).success).toBe(false)
  })
})

describe('HostTimeAnswerSchema (#910)', () => {
  it('still accepts the answer of an older host that only sends serverTime', () => {
    expect(HostTimeAnswerSchema.parse({ serverTime: 5 })).toEqual({ serverTime: 5 })
  })

  it('still rejects an answer without a serverTime', () => {
    expect(HostTimeAnswerSchema.safeParse({ hostId: 'laptop', epoch: 1 }).success).toBe(false)
  })
})

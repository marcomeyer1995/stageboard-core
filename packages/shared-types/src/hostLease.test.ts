import { describe, expect, it } from 'vitest'
import { HostLeaseSchema, LEASE_INTERVAL_MS, LEASE_LENGTH_MS } from './hostLease.js'

describe('HostLeaseSchema (#918)', () => {
  it('accepts hostId, epoch >= 1 and a positive lease length', () => {
    expect(HostLeaseSchema.safeParse({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1 }).success).toBe(true)
  })

  it('rejects an empty host id, an epoch below 1 or a fraction, and a lease of 0 or less', () => {
    for (const bad of [{ hostId: '' }, { epoch: 0 }, { epoch: 1.5 }, { leaseMs: 0 }, { leaseMs: -5 }, { sentAt: -1 }]) {
      expect(HostLeaseSchema.safeParse({ hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1, ...bad }).success).toBe(false)
    }
  })

  it('a lease outlasts a 1-3 s hiccup but stays well under the 5-8 s takeover time', () => {
    expect(LEASE_INTERVAL_MS).toBe(1000)
    expect(LEASE_LENGTH_MS).toBeGreaterThan(3000)
    expect(LEASE_LENGTH_MS).toBeLessThan(5000)
  })
})

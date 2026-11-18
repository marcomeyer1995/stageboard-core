import { describe, expect, it } from 'vitest'
import { leaseKey, signLease, verifyLease } from './hostLeaseAuth.js'

const lease = { hostId: 'laptop', epoch: 1, leaseMs: 4000, sentAt: 1_000 }

describe('host lease signature (#918)', () => {
  it('verifies with the same band code and workspace', () => {
    const key = leaseKey('12345678', 'band-a')
    expect(verifyLease(signLease(lease, key), key)).toEqual(lease)
  })

  it('refuses another code, another workspace, or a changed field', () => {
    const key = leaseKey('12345678', 'band-a')
    const signed = signLease(lease, key)
    expect(verifyLease(signed, leaseKey('87654321', 'band-a'))).toBeNull()
    expect(verifyLease(signed, leaseKey('12345678', 'band-b'))).toBeNull()
    expect(verifyLease({ ...signed, lease: { ...lease, epoch: 2 } }, key)).toBeNull()
    expect(verifyLease({ ...signed, lease: { ...lease, sentAt: 2_000 } }, key)).toBeNull()
  })

  it('refuses garbage instead of throwing', () => {
    const key = leaseKey('12345678', 'band-a')
    for (const bad of [null, 'x', {}, { lease, sig: 'zz' }, { lease, sig: 'a'.repeat(10) }, { lease: { hostId: 'x' }, sig: 'a'.repeat(64) }]) {
      expect(verifyLease(bad, key)).toBeNull()
    }
  })
})

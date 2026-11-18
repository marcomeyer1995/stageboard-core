import { describe, expect, it } from 'vitest'
import { fingerprintMatches } from './hostLeaseService.js'

describe('fingerprintMatches (#918)', () => {
  it('compares the certificate fingerprint in the band list form (lowercase hex, no colons)', () => {
    expect(fingerprintMatches('AA:BB:CC', 'aabbcc')).toBe(true)
    expect(fingerprintMatches('AA:BB:CC', 'aabbcd')).toBe(false)
  })

  it('without a listed fingerprint nothing can be pinned, so it does not match', () => {
    expect(fingerprintMatches('AA:BB', undefined)).toBe(false)
  })
})


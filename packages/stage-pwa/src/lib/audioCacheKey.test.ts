import { describe, expect, it } from 'vitest'
import { cacheKey, parseCacheKey } from './audioCache'

describe('cacheKey', () => {
  it('stays as before for a first file, carries the revision of a replaced one', () => {
    expect(cacheKey('v1', 't1')).toBe('v1:t1')
    expect(cacheKey('v1', 't1', 2)).toBe('v1:t1@2')
    expect(parseCacheKey('v1:t1@2')).toEqual({ variantId: 'v1', trackId: 't1' })
    expect(parseCacheKey('v1:t1')).toEqual({ variantId: 'v1', trackId: 't1' })
  })
})

import { describe, expect, it } from 'vitest'
import { LEGACY_HOST_PATHS, withLegacyPath } from './legacyPaths.js'

describe('legacy host paths (#964)', () => {
  it('every new path is under /host/ and every old one is not', () => {
    for (const [now, before] of Object.entries(LEGACY_HOST_PATHS)) {
      expect(now.startsWith('/host/')).toBe(true)
      expect(before.startsWith('/host/')).toBe(false)
    }
  })
  it('gives a route both its paths, and a path without an alias just itself', () => {
    expect(withLegacyPath('/host/info')).toEqual(['/host/info', '/server-info'])
    expect(withLegacyPath('/time')).toEqual(['/time'])
  })
  it('lists no path twice', () => {
    const all = Object.entries(LEGACY_HOST_PATHS).flat()
    expect(new Set(all).size).toBe(all.length)
  })
})

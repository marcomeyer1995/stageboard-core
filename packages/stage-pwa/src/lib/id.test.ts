import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId } from './id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomId', () => {
  it('produces a v4 UUID', () => {
    expect(randomId()).toMatch(UUID_V4)
  })

  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 100 }, randomId))
    expect(ids.size).toBe(100)
  })

  it('still works where randomUUID is missing (plain http on the stage LAN)', () => {
    // getRandomValues stays available in insecure contexts; randomUUID does not.
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) })
    expect(randomId()).toMatch(UUID_V4)
  })
})

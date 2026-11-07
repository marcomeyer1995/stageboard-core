import { describe, expect, it } from 'vitest'
import { HostCapabilitiesSchema } from 'shared-types'
import { hostCapabilities } from './hostCapabilities.js'

describe('hostCapabilities (docs/25 §6, 2026-11-07)', () => {
  it('names per server plugin whether it runs here and what it lacks; test plugins left out', () => {
    const caps = hostCapabilities({ 'stem-separation': () => 'demucs', 'youtube-download': () => null }, ['stem-separation', 'youtube-download', 'osc', 'mock-mixer'])
    expect(HostCapabilitiesSchema.parse(caps)).toEqual(caps)
    expect(caps.kind).toBe('stage-server')
    expect(caps.plugins).toEqual([
      { id: 'stem-separation', available: false, needs: 'demucs' },
      { id: 'youtube-download', available: true, needs: null },
      { id: 'osc', available: true, needs: null },
    ])
  })

  it('reports the database the host runs on', () => {
    const before = process.env.STAGEBOARD_DB
    process.env.STAGEBOARD_DB = 'builtin'
    expect(hostCapabilities({}, []).database).toBe('builtin')
    delete process.env.STAGEBOARD_DB
    expect(hostCapabilities({}, []).database).toBe('couchdb')
    if (before !== undefined) process.env.STAGEBOARD_DB = before
  })
})

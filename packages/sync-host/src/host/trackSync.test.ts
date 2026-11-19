import { describe, expect, it } from 'vitest'
import { parseTrackKey, planTrackSync, trackKey, tracksOfVariantDocs } from './trackSync.js'

describe('track keys', () => {
  it('name a track by variant, track and - once the file was replaced - its revision', () => {
    expect(trackKey('v1', 't1')).toBe('v1:t1')
    expect(trackKey('v1', 't1', 3)).toBe('v1:t1@3')
    expect(parseTrackKey('v1:t1@3')).toEqual({ variantId: 'v1', trackId: 't1', fileRev: 3 })
    expect(parseTrackKey('v1:t1')).toEqual({ variantId: 'v1', trackId: 't1' })
  })

  it('treat a missing or zero revision as the first file', () => {
    expect(trackKey('v', 't', 0)).toBe('v:t')
    expect(trackKey('v', 't', undefined)).toBe('v:t')
    expect(parseTrackKey('v:t@0')).toEqual({ variantId: 'v', trackId: 't' })
  })
})

describe('what the song variants list', () => {
  const docs = [
    { _id: 'song-variants:var1', id: 'var1', tracks: [{ id: 'trk1' }, { id: 'trk2', fileRev: 3 }] },
    { _id: 'songs:x', id: 'x', tracks: [{ id: 'nope' }] },
    { _id: 'song-variants:../evil', id: '../evil', tracks: [{ id: 'a' }] },
    { _id: 'song-variants:var2', id: 'var2', tracks: [{ id: 'a/b' }, { id: 'ok' }, 'junk'] },
  ]

  it('is every track of a song-variant document, with its revision', () => {
    expect(tracksOfVariantDocs(docs)).toEqual([
      { variantId: 'var1', trackId: 'trk1', fileRev: undefined },
      { variantId: 'var1', trackId: 'trk2', fileRev: 3 },
      { variantId: 'var2', trackId: 'ok', fileRev: undefined },
    ])
  })
})

describe('planTrackSync', () => {
  it('fetches what is wanted and not held, and counts what is already here', () => {
    expect(planTrackSync(['a:1', 'a:2', 'b:1'], ['a:1'])).toEqual({ fetch: ['a:2', 'b:1'], evict: [], present: 1 })
  })

  it('treats a file held under an older revision as missing - the new one is fetched', () => {
    const plan = planTrackSync(['a:1@4'], ['a:1@3'], { evict: true })
    expect(plan).toEqual({ fetch: ['a:1@4'], evict: ['a:1@3'], present: 0 })
  })

  it('treats a file with no revision as old once the track names one (an upload nobody stamped)', () => {
    expect(planTrackSync(['a:1@2'], ['a:1']).fetch).toEqual(['a:1@2'])
  })

  it('evicts what is held and not wanted - only when asked to', () => {
    expect(planTrackSync(['a:1'], ['a:1', 'z:9'], { evict: true })).toEqual({ fetch: [], evict: ['z:9'], present: 1 })
    expect(planTrackSync(['a:1'], ['a:1', 'z:9'])).toEqual({ fetch: [], evict: [], present: 1 })
  })

  it('wants nothing: everything held is evicted (sync mode none), a host that mirrors keeps it', () => {
    expect(planTrackSync([], ['a:1', 'b:2'], { evict: true }).evict).toEqual(['a:1', 'b:2'])
    expect(planTrackSync([], ['a:1', 'b:2']).evict).toEqual([])
  })

  it('does not list a track twice, whatever the input repeats', () => {
    expect(planTrackSync(['a:1', 'a:1'], ['x:1', 'x:1'], { evict: true })).toEqual({ fetch: ['a:1'], evict: ['x:1'], present: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import type { Song, SongVariant } from 'shared-types'
import { findLogicalDeviceUsage } from './logicalDeviceUsage'

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, chordProContent: '', timecodes: [] }
}

function variant(overrides: Partial<SongVariant> & Pick<SongVariant, 'id' | 'songId'>): SongVariant {
  return { label: 'Original', isDefault: true, bpm: 120, chordProContent: '', timecodes: [], tracks: [], cues: [], ...overrides }
}

describe('findLogicalDeviceUsage', () => {
  it('is empty when nothing references the Logical Device', () => {
    const variants = [variant({ id: 'v1', songId: 'song-a' })]
    expect(findLogicalDeviceUsage('kemper-1', variants, [song('song-a', 'A')])).toEqual([])
  })

  it('finds a variant whose cue targets the Logical Device, resolving the song title', () => {
    const variants = [
      variant({
        id: 'v1',
        songId: 'song-a',
        label: 'Live',
        cues: [{ id: 'c1', timeMs: 0, type: 'select_rig', targetLogicalDeviceId: 'kemper-1' }],
      }),
    ]
    expect(findLogicalDeviceUsage('kemper-1', variants, [song('song-a', 'Sweet Caroline')])).toEqual([
      { songId: 'song-a', songTitle: 'Sweet Caroline', variantLabel: 'Live' },
    ])
  })

  it('falls back to the raw songId when no matching Song doc is loaded', () => {
    const variants = [
      variant({ id: 'v1', songId: 'song-a', cues: [{ id: 'c1', timeMs: 0, type: 'x', targetLogicalDeviceId: 'kemper-1' }] }),
    ]
    expect(findLogicalDeviceUsage('kemper-1', variants, [])).toEqual([{ songId: 'song-a', songTitle: 'song-a', variantLabel: 'Original' }])
  })

  it('lists every variant that references it, across multiple songs', () => {
    const variants = [
      variant({ id: 'v1', songId: 'song-a', cues: [{ id: 'c1', timeMs: 0, type: 'x', targetLogicalDeviceId: 'kemper-1' }] }),
      variant({ id: 'v2', songId: 'song-b', cues: [{ id: 'c2', timeMs: 0, type: 'x', targetLogicalDeviceId: 'kemper-1' }] }),
      variant({ id: 'v3', songId: 'song-c', cues: [{ id: 'c3', timeMs: 0, type: 'x', targetLogicalDeviceId: 'mixer-1' }] }),
    ]
    const songs = [song('song-a', 'A'), song('song-b', 'B'), song('song-c', 'C')]
    expect(findLogicalDeviceUsage('kemper-1', variants, songs)).toHaveLength(2)
  })
})

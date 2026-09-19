import { describe, expect, it } from 'vitest'
import type { SongEntry, SongVariant } from 'shared-types'
import { countInDurationMs, songDurationMs } from './entryDuration'

const entry: SongEntry = { id: 'e', songId: 's', variantId: null, trackId: null }

function variant(over: Partial<SongVariant> = {}, trackMs?: number): SongVariant {
  return {
    id: 'v',
    songId: 's',
    label: 'Original',
    isDefault: true,
    bpm: 120,
    timeSignature: '4/4',
    clickTrackEnabled: false,
    chordProContent: '',
    timecodes: [],
    tracks: trackMs === undefined ? [] : [{ id: 't', kind: 'band-mix', label: 'Mix', source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 0, durationMs: trackMs }],
    cues: [],
    beatAnchors: [],
    tempoMarkers: [],
    countInEnabled: false,
    countInBars: 1,
    ...over,
  } as SongVariant
}

describe('songDurationMs', () => {
  it('is the selected track length, winning over a manual length', () => {
    expect(songDurationMs(entry, variant({ durationMs: 999 }, 200_000), null)).toEqual({ ms: 200_000, source: 'track' })
  })

  it('is the manual length without a track (click-only songs)', () => {
    expect(songDurationMs(entry, variant({ durationMs: 180_000 }), null)).toEqual({ ms: 180_000, source: 'manual' })
  })

  it('is unknown with neither, so nothing stops and the clock estimates', () => {
    expect(songDurationMs(entry, variant(), null)).toBeNull()
    expect(songDurationMs(entry, null, null)).toBeNull()
  })

  it('falls back to the manual length while the track is unmeasured', () => {
    expect(songDurationMs(entry, variant({ durationMs: 180_000 }, undefined as never), null)?.source).toBe('manual')
  })
})

describe('countInDurationMs', () => {
  it('is zero without a count-in, and for one that fits the lead-in silence', () => {
    expect(countInDurationMs(variant())).toBe(0)
    expect(countInDurationMs(variant({ countInEnabled: true, countInBars: 1, beatAnchors: [{ id: 'a1', timeMs: 5000, beatInBar: 0 }] }))).toBe(0)
  })

  it('is the part of the count-in that sticks out before position 0', () => {
    expect(countInDurationMs(variant({ countInEnabled: true, countInBars: 2, beatAnchors: [{ id: 'a1', timeMs: 350, beatInBar: 0 }] }))).toBe(3650)
  })
})

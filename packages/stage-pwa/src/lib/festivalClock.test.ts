import { describe, expect, it } from 'vitest'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import type { QueueItem } from './computeQueue'
import { computeFestivalClock, resolveTargetEnd } from './festivalClock'

const MIN = 60_000

function song(id: string): Song {
  return { id, title: id, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}

function variantWith(songId: string, durationMs: number | undefined): SongVariant {
  return {
    id: `v-${songId}`,
    songId,
    label: 'Original',
    isDefault: true,
    bpm: 120,
    timeSignature: '4/4',
    clickTrackEnabled: false,
    chordProContent: '',
    timecodes: [],
    tracks: [{ id: 't', kind: 'band-mix', label: 'Mix', source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 0, durationMs }],
    cues: [],
    beatAnchors: [],
    tempoMarkers: [],
    countInEnabled: false,
    countInBars: 1,
  } as SongVariant
}

function songItem(id: string, durationMs: number | undefined, over: Partial<Extract<SetlistEntry, { songId: string }>> = {}): QueueItem {
  const entry = { id, songId: id, variantId: null, trackId: null, ...over }
  return { entry, song: song(id), variant: variantWith(id, durationMs) }
}

function itemEntry(id: string, over: Record<string, unknown> = {}): QueueItem {
  return { entry: { id, kind: 'transition', title: id, notes: '', ...over } as SetlistEntry, song: null, variant: null }
}

const NOW = new Date('2026-09-19T22:15:00').getTime()
const base = { playbackStatus: 'stopped' as const, elapsedMs: null, now: NOW }

describe('computeFestivalClock', () => {
  it('sums song lengths plus the default pause between songs', () => {
    const items = [songItem('a', 4 * MIN), songItem('b', 4 * MIN), songItem('c', 4 * MIN)]
    const result = computeFestivalClock({ ...base, items, currentEntryId: 'a', setlist: { defaultTransitionMs: 30_000 } })
    expect(result.remainingMs).toBe(12 * MIN + 2 * 30_000)
    expect(result.predictedEnd).toBe(NOW + result.remainingMs)
    expect(result.targetEnd).toBeNull()
    expect(result.overrunMs).toBeNull()
  })

  it('counts only what is left of the playing song', () => {
    const items = [songItem('a', 4 * MIN), songItem('b', 4 * MIN)]
    const result = computeFestivalClock({
      ...base,
      items,
      currentEntryId: 'a',
      playbackStatus: 'playing',
      elapsedMs: 3 * MIN,
      setlist: { defaultTransitionMs: 0 },
    })
    expect(result.remainingMs).toBe(1 * MIN + 4 * MIN)
  })

  it('ignores songs already played', () => {
    const items = [songItem('a', 4 * MIN), songItem('b', 4 * MIN), songItem('c', 4 * MIN)]
    const result = computeFestivalClock({ ...base, items, currentEntryId: 'c', setlist: { defaultTransitionMs: 30_000 } })
    expect(result.remainingMs).toBe(4 * MIN)
  })

  it('adds no pause after a seamless song, and its own delay after a delayed one', () => {
    const seamless = [songItem('a', 4 * MIN, { transitionType: 'seamless' }), songItem('b', 4 * MIN)]
    expect(computeFestivalClock({ ...base, items: seamless, currentEntryId: 'a', setlist: { defaultTransitionMs: 30_000 } }).remainingMs).toBe(8 * MIN)
    const delayed = [songItem('a', 4 * MIN, { transitionType: 'delayed', transitionDelayMs: 10_000 }), songItem('b', 4 * MIN)]
    expect(computeFestivalClock({ ...base, items: delayed, currentEntryId: 'a', setlist: { defaultTransitionMs: 30_000 } }).remainingMs).toBe(8 * MIN + 10_000)
  })

  it('counts an announcement by its own duration and adds no extra pause around it', () => {
    const items = [songItem('a', 4 * MIN), itemEntry('t', { estimatedDurationMs: 60_000 }), songItem('b', 4 * MIN)]
    const result = computeFestivalClock({ ...base, items, currentEntryId: 'a', setlist: { defaultTransitionMs: 30_000 } })
    expect(result.remainingMs).toBe(9 * MIN)
  })

  it('uses the default pause for an announcement without a duration', () => {
    const items = [itemEntry('t'), songItem('b', 4 * MIN)]
    const result = computeFestivalClock({ ...base, items, currentEntryId: 't', setlist: { defaultTransitionMs: 45_000 } })
    expect(result.remainingMs).toBe(45_000 + 4 * MIN)
  })

  it('estimates songs without a measured length and reports how many', () => {
    const items = [songItem('a', undefined), songItem('b', 4 * MIN)]
    const result = computeFestivalClock({
      ...base,
      items,
      currentEntryId: 'a',
      setlist: { defaultTransitionMs: 0, defaultSongDurationMs: 3 * MIN },
    })
    expect(result.remainingMs).toBe(7 * MIN)
    expect(result.estimatedSongs).toBe(1)
  })

  it('reports the curfew example: 50 minutes left at 22:15 against 23:00 is a 5 minute overrun', () => {
    const items = [songItem('a', 50 * MIN)]
    const result = computeFestivalClock({ ...base, items, currentEntryId: 'a', setlist: { targetEndTime: '23:00' } })
    expect(result.overrunMs).toBe(5 * MIN)
  })

  it('reports a buffer as a negative overrun', () => {
    const items = [songItem('a', 30 * MIN)]
    const result = computeFestivalClock({ ...base, items, currentEntryId: 'a', setlist: { targetEndTime: '23:00' } })
    expect(result.overrunMs).toBe(-15 * MIN)
  })
})

describe('resolveTargetEnd', () => {
  it('is today at that time', () => {
    expect(resolveTargetEnd(NOW, '23:00')).toBe(new Date('2026-09-19T23:00:00').getTime())
  })

  it('rolls over to tomorrow when the time is far in the past (set running past midnight)', () => {
    const lateNight = new Date('2026-09-19T23:30:00').getTime()
    expect(resolveTargetEnd(lateNight, '00:30')).toBe(new Date('2026-09-20T00:30:00').getTime())
  })
})

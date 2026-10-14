import { describe, expect, it } from 'vitest'
import type { BeatGrid } from 'shared-types'
import { clickTimeline } from './beatGrid'
import { clockTicksBetween, freeRunTickMs, songPositionAt, songPositionPointer } from './midiClock'

const grid = (...points: [number, number][]): BeatGrid => ({
  points: points.map(([bar, timeMs], i) => ({ id: `p${i}`, bar, timeMs })),
  meters: [],
})

describe('MIDI clock from the click grid (#478)', () => {
  it('ticks 24 times per beat - every 20.83 ms at 120 BPM', () => {
    const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })
    const ticks = clockTicksBetween(timeline, 0, 1000)
    expect(ticks).toHaveLength(48)
    expect(ticks[1]! - ticks[0]!).toBeCloseTo(500 / 24, 6)
    expect(freeRunTickMs(timeline)).toBeCloseTo(500 / 24, 6)
  })

  it('follows a tempo change of the grid beat by beat', () => {
    // Bar 1 at 0 ms, bar 2 at 2000 ms (120 BPM), bar 3 at 3600 ms (150 BPM).
    const timeline = clickTimeline({
      beatGrid: grid([1, 0], [2, 2000], [3, 3600]),
      bpm: 120,
      timeSignature: '4/4',
    })
    const slow = clockTicksBetween(timeline, 0, 500)
    const fast = clockTicksBetween(timeline, 2000, 2400)
    expect(slow[1]! - slow[0]!).toBeCloseTo(500 / 24, 6)
    expect(fast[1]! - fast[0]!).toBeCloseTo(400 / 24, 6)
  })

  it('also ticks through the count-in, before bar 1', () => {
    const timeline = clickTimeline({
      bpm: 120,
      timeSignature: '4/4',
      countInBars: 1,
    })
    const ticks = clockTicksBetween(timeline, -2000, 0)
    expect(ticks).toHaveLength(96)
    expect(ticks[0]).toBeCloseTo(-2000, 6)
  })

  it('resumes on the next 16th with the right Song Position Pointer', () => {
    const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' }) // a 16th = 125 ms
    expect(songPositionAt(timeline, 1010)).toEqual({
      sixteenths: 9,
      atMs: 1125,
    })
    expect(songPositionAt(timeline, 1000)).toEqual({
      sixteenths: 8,
      atMs: 1000,
    })
    expect(songPositionAt(timeline, -300)).toEqual({ sixteenths: 0, atMs: 0 }) // before bar 1: from the top
    // Grid starting late (silence before bar 1): position 0 is bar 1, not the file start.
    expect(
      songPositionAt(
        clickTimeline({
          beatGrid: grid([1, 800]),
          bpm: 120,
          timeSignature: '4/4',
        }),
        400,
      ),
    ).toEqual({ sixteenths: 0, atMs: 800 })
  })

  it('encodes the Song Position Pointer as 14 bits, LSB first', () => {
    expect(songPositionPointer(9)).toEqual([0xf2, 9, 0])
    expect(songPositionPointer(300)).toEqual([0xf2, 300 & 0x7f, 300 >> 7])
  })
})

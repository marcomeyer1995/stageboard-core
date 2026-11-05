import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { formatLoopPoint, snapLoopPoint, stepLoopPoint } from './loopSnap'

// 120 BPM 4/4 from 0:00: a beat every 500 ms, a bar every 2 s - bar 6 starts at 10 s.
const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })

describe('loop points on the grid (#683)', () => {
  it('snaps to the nearest bar or beat, and leaves free points alone', () => {
    expect(snapLoopPoint(timeline, 10_900, 'bars')).toBe(10_000)
    expect(snapLoopPoint(timeline, 11_100, 'bars')).toBe(12_000)
    expect(snapLoopPoint(timeline, 10_300, 'beats')).toBe(10_500)
    expect(snapLoopPoint(timeline, 10_337.6, 'free')).toBe(10_338)
  })

  it('treats every mode as free without a grid', () => {
    expect(snapLoopPoint(null, 10_900, 'bars')).toBe(10_900)
    expect(stepLoopPoint(null, 10_900, 'bars', 1)).toBe(11_000)
  })

  it('moves one bar, beat or time step with −/+ (B from bar 10 to 11)', () => {
    const bar10 = 18_000
    expect(stepLoopPoint(timeline, bar10, 'bars', 1)).toBe(20_000)
    expect(stepLoopPoint(timeline, bar10, 'bars', -1)).toBe(16_000)
    expect(stepLoopPoint(timeline, bar10, 'beats', 1)).toBe(18_500)
    expect(stepLoopPoint(timeline, bar10, 'free', -1)).toBe(17_900)
  })

  it('from between two lines goes to the nearer one in that direction', () => {
    expect(stepLoopPoint(timeline, 18_700, 'bars', 1)).toBe(20_000)
    expect(stepLoopPoint(timeline, 18_700, 'bars', -1)).toBe(18_000)
    expect(stepLoopPoint(timeline, 18_700, 'beats', -1)).toBe(18_500)
  })

  it('never goes before the song start', () => {
    expect(stepLoopPoint(timeline, 0, 'bars', -1)).toBe(0)
    expect(stepLoopPoint(timeline, 50, 'free', -1)).toBe(0)
  })

  it('reads out bar, bar.beat or time', () => {
    expect(formatLoopPoint(timeline, 18_000, 'bars')).toBe('10')
    expect(formatLoopPoint(timeline, 19_000, 'beats')).toBe('10.3')
    expect(formatLoopPoint(timeline, 83_400, 'free')).toBe('1:23.4')
  })
})

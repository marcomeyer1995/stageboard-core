import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { clickTimeline, setPoint } from './beatGrid'
import { anchorAt, applyCueAnchors, settleCueAnchors, timeOfAnchor } from './cueAnchors'

// 120 BPM 4/4, bar 1 at 1 s: a beat every 500 ms, bar 17 beat 1 at 1 + 16 * 2 = 33 s.
const grid = { points: [{ id: 'p1', bar: 1, timeMs: 1000 }], meters: [] }
const timeline = clickTimeline({ beatGrid: grid, bpm: 120, timeSignature: '4/4' })
const cue = (id: string, timeMs: number, anchor?: ShowCue['anchor']): ShowCue => ({ id, timeMs, targetLogicalDeviceId: 'kemper', type: 'kemper.selectRig', ...(anchor ? { anchor } : {}) }) as ShowCue

describe('cueAnchors (#483)', () => {
  it('finds the bar and beat a time sits on - none between beats or before bar 1', () => {
    expect(anchorAt(timeline, 33_000)).toEqual({ bar: 17, beat: 1 })
    expect(anchorAt(timeline, 33_500)).toEqual({ bar: 17, beat: 2 })
    expect(anchorAt(timeline, 33_250)).toBeNull()
    expect(anchorAt(timeline, 500)).toBeNull()
    expect(timeOfAnchor(timeline, { bar: 17, beat: 1 })).toBe(33_000)
  })

  it('a cue on bar 17 beat 1 moves with the grid when bar 9 is re-aligned; a free cue stays', () => {
    const cues = [cue('a', 33_000, { bar: 17, beat: 1 }), cue('free', 20_250)]
    // Second point: bar 9 200 ms later than the straight tempo had it (17 s -> 17.2 s).
    const moved = setPoint(grid, 9, 17_200, '4/4')!
    const next = clickTimeline({ beatGrid: moved, bpm: 120, timeSignature: '4/4' })
    const settled = settleCueAnchors(cues, cues, next)
    expect(settled.find((c) => c.id === 'a')).toMatchObject({ anchor: { bar: 17, beat: 1 }, timeMs: timeOfAnchor(next, { bar: 17, beat: 1 }) })
    expect(settled.find((c) => c.id === 'a')!.timeMs).not.toBe(33_000)
    expect(settled.find((c) => c.id === 'free')).toEqual(cues[1])
  })

  it('a cue placed or moved onto a beat is anchored; nudged off the beat it is free again', () => {
    const before = [cue('a', 20_250)]
    const snapped = settleCueAnchors(before, [cue('a', 33_000)], timeline)
    expect(snapped[0].anchor).toEqual({ bar: 17, beat: 1 })
    const nudged = settleCueAnchors(snapped, [{ ...snapped[0], timeMs: 33_050 }], timeline)
    expect(nudged[0].anchor).toBeUndefined()
    expect(nudged[0].timeMs).toBe(33_050)
    const added = settleCueAnchors([], [cue('n', 3_000)], timeline)
    expect(added[0].anchor).toEqual({ bar: 2, beat: 1 })
  })

  it('applyCueAnchors puts anchored cues at their place after a tempo change', () => {
    const faster = clickTimeline({ beatGrid: grid, bpm: 150, timeSignature: '4/4' })
    const [a] = applyCueAnchors([cue('a', 33_000, { bar: 17, beat: 1 })], faster)
    expect(a.timeMs).toBe(1000 + 64 * 400)
  })
})

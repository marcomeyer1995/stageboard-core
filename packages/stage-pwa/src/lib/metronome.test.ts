import { describe, expect, it } from 'vitest'
import { adjustedBpm, beatAt, beatsPerBar, type BeatAnchorLike, effectiveClickEnabled, resolveBeatGrid, resolveBeatOrigin, upcomingBeats } from './metronome'

/** None of the pre-#25-follow-up tests below ever expect a count-in (null) state - they all
 * call `beatAt` with no anchors, which `resolveBeatOrigin` always resolves to origin 0, never
 * null. This just narrows the type back to `Beat` at the call site so those tests (kept
 * byte-for-byte as they were, per the invariant this feature must preserve) still compile. */
function mustBeatAt(...args: Parameters<typeof beatAt>): NonNullable<ReturnType<typeof beatAt>> {
  const beat = beatAt(...args)
  if (beat === null) throw new Error('expected a beat, got the count-in state')
  return beat
}

describe('effectiveClickEnabled', () => {
  it('defers to the song default when there is no live override', () => {
    expect(effectiveClickEnabled(true, null)).toBe(true)
    expect(effectiveClickEnabled(false, null)).toBe(false)
  })

  it('forces on/off regardless of the song default when overridden', () => {
    expect(effectiveClickEnabled(false, 'on')).toBe(true)
    expect(effectiveClickEnabled(true, 'off')).toBe(false)
  })
})

describe('adjustedBpm', () => {
  it('is a no-op at 0%', () => {
    expect(adjustedBpm(120, 0)).toBe(120)
  })

  it('applies a positive or negative percent correction', () => {
    expect(adjustedBpm(120, 5)).toBeCloseTo(126)
    expect(adjustedBpm(120, -5)).toBeCloseTo(114)
  })
})

describe('beatsPerBar', () => {
  it('reads the numerator of a normal time signature', () => {
    expect(beatsPerBar('4/4')).toBe(4)
    expect(beatsPerBar('3/4')).toBe(3)
    expect(beatsPerBar('6/8')).toBe(6)
  })

  it('falls back to 4 for anything unparseable, rather than throwing', () => {
    expect(beatsPerBar('')).toBe(4)
    expect(beatsPerBar('waltz')).toBe(4)
    expect(beatsPerBar('0/4')).toBe(4)
    expect(beatsPerBar('-2/4')).toBe(4)
  })
})

describe('beatAt', () => {
  it('is the downbeat at elapsedMs 0', () => {
    const beat = mustBeatAt(0, 120, '4/4')
    expect(beat.beatInBar).toBe(0)
    expect(beat.isDownbeat).toBe(true)
    expect(beat.msIntoBeat).toBe(0)
  })

  // 120 BPM = 500ms per beat.
  it('advances one beat per 500ms at 120 BPM', () => {
    expect(mustBeatAt(499, 120, '4/4').beatInBar).toBe(0)
    expect(mustBeatAt(500, 120, '4/4').beatInBar).toBe(1)
    expect(mustBeatAt(999, 120, '4/4').beatInBar).toBe(1)
    expect(mustBeatAt(1000, 120, '4/4').beatInBar).toBe(2)
  })

  it('wraps back to the downbeat at the start of every bar, per the time signature', () => {
    // 4/4 at 120 BPM: bar is 2000ms, beat 4 (index 4) wraps to beatInBar 0.
    const beat = mustBeatAt(2000, 120, '4/4')
    expect(beat.beatInBar).toBe(0)
    expect(beat.isDownbeat).toBe(true)
  })

  it('respects a non-4/4 time signature', () => {
    // 3/4 at 120 BPM: beat index 3 (1500ms) wraps to beatInBar 0.
    expect(mustBeatAt(1500, 120, '3/4').beatInBar).toBe(0)
    expect(mustBeatAt(1000, 120, '3/4').beatInBar).toBe(2)
  })

  it('reports how far into the current beat elapsedMs is', () => {
    const beat = mustBeatAt(650, 120, '4/4')
    expect(beat.beatInBar).toBe(1)
    expect(beat.msIntoBeat).toBeCloseTo(150)
  })

  it('is byte-identical to the pre-anchor formula when no anchors are given (the default) - the required invariant for every existing song', () => {
    for (const elapsedMs of [0, 1, 499, 500, 999, 1000, 2000, 123456]) {
      const withDefault = beatAt(elapsedMs, 120, '4/4')
      const withEmptyAnchors = beatAt(elapsedMs, 120, '4/4', [])
      expect(withDefault).toEqual(withEmptyAnchors)
      expect(withDefault).not.toBeNull()
    }
  })
})

describe('resolveBeatOrigin', () => {
  it('is 0 with no anchors at all - reproduces the old beat-0-at-song-start behavior', () => {
    expect(resolveBeatOrigin([], 0)).toBe(0)
    expect(resolveBeatOrigin([], 999999)).toBe(0)
  })

  it('is null before the first anchor - a count-in state, not a beat position', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 5000 }]
    expect(resolveBeatOrigin(anchors, 0)).toBeNull()
    expect(resolveBeatOrigin(anchors, 4999)).toBeNull()
  })

  it('is exactly the anchor at the instant it becomes active', () => {
    expect(resolveBeatOrigin([{ timeMs: 5000 }], 5000)).toBe(5000)
  })

  it('picks the latest anchor at or before elapsedMs, out of several, regardless of array order', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 10000 }, { timeMs: 5000 }, { timeMs: 20000 }]
    expect(resolveBeatOrigin(anchors, 12000)).toBe(10000)
    expect(resolveBeatOrigin(anchors, 25000)).toBe(20000)
    expect(resolveBeatOrigin(anchors, 6000)).toBe(5000)
  })

  it('collapses a near-duplicate anchor (e.g. a key-repeat double-tap) into the earlier one, instead of treating it as a real, near-instantaneous segment', () => {
    // Found live, 2026-09-10: a key-repeat bug in TapBeatAnchors.tsx let a held Space key
    // insert anchors as little as 28ms apart. Without collapsing, the later one would briefly
    // become its own valid origin for a near-zero-length sliver of elapsedMs.
    const anchors: BeatAnchorLike[] = [{ timeMs: 5000 }, { timeMs: 5028 }]
    expect(resolveBeatOrigin(anchors, 5028)).toBe(5000)
    expect(resolveBeatOrigin(anchors, 6000)).toBe(5000)
  })
})

describe('resolveBeatGrid', () => {
  it('is origin 0 with correctionRatio 1 with no anchors - reproduces the old grid exactly', () => {
    expect(resolveBeatGrid([], 12345, 120)).toEqual({ originMs: 0, correctionRatio: 1 })
  })

  it('is null before the first anchor', () => {
    expect(resolveBeatGrid([{ timeMs: 5000 }], 0, 120)).toBeNull()
  })

  it('is correctionRatio 1 with no next anchor to lock onto (the open-ended final segment)', () => {
    expect(resolveBeatGrid([{ timeMs: 0 }], 999999, 120)).toEqual({ originMs: 0, correctionRatio: 1 })
  })

  it('is correctionRatio 1 when the gap already divides evenly into whole beats', () => {
    // 120 BPM = 500ms/beat; a 2000ms gap is exactly 4 beats, nothing to correct.
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 2000 }]
    expect(resolveBeatGrid(anchors, 0, 120)).toEqual({ originMs: 0, correctionRatio: 1 })
  })

  it('derives a correctionRatio that divides an uneven gap evenly across the nearest whole number of beats', () => {
    // 120 BPM = 500ms/beat nominal; a 2100ms gap rounds to 4 beats (2100/500 = 4.2), so each
    // beat is stretched to 525ms (2100/4) instead - a 1.05x ratio, not a jump/duplicate at 2100.
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 2100 }]
    expect(resolveBeatGrid(anchors, 0, 120)).toEqual({ originMs: 0, correctionRatio: 1.05 })
  })

  it('ignores a near-duplicate anchor rather than trying to divide the near-zero gap it would otherwise create', () => {
    // Same 28ms key-repeat scenario as the resolveBeatOrigin test above - the duplicate at 5028
    // must not become "the next anchor" governing a 28ms-long segment.
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 5000 }, { timeMs: 5028 }]
    const grid = resolveBeatGrid(anchors, 2000, 120)
    expect(grid?.originMs).toBe(0)
    // 5028 is treated as part of the 5000 anchor, so there's no anchor beyond 5000 in this
    // list - correctionRatio falls back to 1 (open-ended), not some wild value derived from a
    // 28ms gap.
    expect(grid?.correctionRatio).toBe(1)
  })

  it('only ever looks at the segment elapsedMs currently sits in, not the whole anchor list', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 2100 }, { timeMs: 5000 }]
    // Inside the first segment (0 - 2100): corrected for that gap's own irregularity.
    expect(resolveBeatGrid(anchors, 1000, 120)).toEqual({ originMs: 0, correctionRatio: 1.05 })
    // Inside the second segment (2100 - 5000): a clean 2900ms/500ms = 5.8 -> rounds to 6 beats
    // -> 2900/6 = 483.33ms/beat -> ratio 483.33/500.
    const grid = resolveBeatGrid(anchors, 3000, 120)
    expect(grid?.originMs).toBe(2100)
    expect(grid?.correctionRatio).toBeCloseTo(2900 / 6 / 500)
  })
})

describe('resolveBeatGrid - tail continuation past the last anchor', () => {
  it('reuses the previous segment\'s corrected ratio for the open-ended tail, instead of reverting to the plain nominal bpm', () => {
    // 120 BPM = 500ms/beat nominal. Three anchors: the tail after the last one (5150) should be
    // corrected using the segment BEFORE it (2100 -> 5150), not the whole 0 -> 5150 span and not
    // a flat ratio of 1.
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 2100 }, { timeMs: 5150 }]
    const grid = resolveBeatGrid(anchors, 6000, 120)
    expect(grid?.originMs).toBe(5150)
    // gap 2100->5150 = 3050ms, rounds to 6 beats -> 3050/6/500.
    expect(grid?.correctionRatio).toBeCloseTo(3050 / 6 / 500)
  })

  it('still falls back to correctionRatio 1 with only one anchor total - nothing to derive a tail ratio from', () => {
    expect(resolveBeatGrid([{ timeMs: 0 }], 999999, 120)).toEqual({ originMs: 0, correctionRatio: 1 })
  })
})

describe('resolveBeatGrid - count-in', () => {
  it('is null before the count-in window even when countInBars is configured, same as with no count-in at all', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 2100 }, { timeMs: 4200 }]
    // The count-in window is 2100 - 4*525 = 0ms long here (see the test below) - anything
    // before elapsedMs 0 can't be reached at all, so this just re-confirms countInBars <= 0
    // and "no anchors yet" both still produce null.
    expect(resolveBeatGrid([], 0, 120, '4/4', 2)).toEqual({ originMs: 0, correctionRatio: 1 }) // no anchors: count-in is a no-op
    expect(resolveBeatGrid(anchors, 100, 120, '4/4', 0)).toBeNull() // countInBars 0: unchanged behavior
  })

  it('plays backward from the first anchor at the first segment\'s own corrected tempo, phase-continuous into it', () => {
    // Same anchors/ratio as the clickEngine.test.ts count-in test: 2100/4200 correct to 525ms
    // beats (1.05 ratio). A 1-bar (4-beat) count-in is exactly 2100ms long, so its window starts
    // exactly at elapsedMs 0.
    const anchors: BeatAnchorLike[] = [{ timeMs: 2100 }, { timeMs: 4200 }]
    const grid = resolveBeatGrid(anchors, 0, 120, '4/4', 1)
    expect(grid).toEqual({ originMs: 0, correctionRatio: 1.05 })
    // One tick earlier would be before the window - still a true count-in/silence state.
    expect(resolveBeatGrid(anchors, -1, 120, '4/4', 1)).toBeNull()
  })

  it('falls back to the nominal bpm for the count-in when there is no second anchor yet to derive a tempo from', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 2000 }]
    // 1 bar (4 beats) at the nominal 500ms/beat = 2000ms before the anchor -> starts at 0.
    const grid = resolveBeatGrid(anchors, 0, 120, '4/4', 1)
    expect(grid).toEqual({ originMs: 0, correctionRatio: 1 })
  })
})

describe('beatAt with anchors', () => {
  it('returns null before the first anchor', () => {
    expect(beatAt(0, 120, '4/4', [{ timeMs: 5000 }])).toBeNull()
  })

  it('is exactly the downbeat at the anchor itself', () => {
    const beat = mustBeatAt(5000, 120, '4/4', [{ timeMs: 5000 }])
    expect(beat.beatInBar).toBe(0)
    expect(beat.isDownbeat).toBe(true)
    expect(beat.msIntoBeat).toBe(0)
  })

  it('resets phase at the next anchor, correcting whatever happened before it (e.g. a dropped/added beat)', () => {
    // 120 BPM = 500ms/beat. First anchor at 0, second anchor at 5150ms - not a multiple of
    // 500ms away from the first, exactly the kind of irregularity (a bar that didn't line up
    // with straight bpm-math) an anchor is meant to correct for.
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 5150 }]
    const atAnchor = mustBeatAt(5150, 120, '4/4', anchors)
    expect(atAnchor.beatInBar).toBe(0)
    expect(atAnchor.isDownbeat).toBe(true)
    expect(atAnchor.msIntoBeat).toBe(0)
    // 250ms after the second anchor is still beat 0 (250ms into a 500ms beat) - true under
    // both the old nominal-500ms grid and the corrected 515ms one (see below), so this alone
    // wouldn't catch a regression back to the plain nominal bpm.
    const after = mustBeatAt(5400, 120, '4/4', anchors)
    expect(after.beatInBar).toBe(0)
    expect(after.msIntoBeat).toBeCloseTo(250)
    // Further into the tail, the two grids diverge: 4 corrected 515ms beats land exactly on
    // 2060ms past the anchor (msIntoBeat 0), whereas 4 plain nominal 500ms beats would only
    // reach 2000ms, leaving 60ms into the beat - this is what actually proves the tail reuses
    // the last real segment's corrected ratio (#25 follow-up) instead of the plain bpm.
    const deepInTail = mustBeatAt(5150 + 2060, 120, '4/4', anchors)
    expect(deepInTail.beatInBar).toBe(0)
    expect(deepInTail.msIntoBeat).toBeCloseTo(0)
  })

  it('uses the smoothed correctionRatio for spacing inside the segment, not the raw nominal bpm (#25 follow-up smoothing fix)', () => {
    // Same 2100ms/4-beat gap as the resolveBeatGrid tests above - each beat is 525ms, not the
    // nominal 500ms, so the segment's beats land evenly and the last one coincides exactly with
    // anchor 1 instead of overshooting/undershooting it.
    const anchors: BeatAnchorLike[] = [{ timeMs: 0 }, { timeMs: 2100 }]
    const beat0 = mustBeatAt(524, 120, '4/4', anchors)
    expect(beat0.beatInBar).toBe(0) // still just shy of the corrected 525ms boundary
    const beat1 = mustBeatAt(525, 120, '4/4', anchors)
    expect(beat1.beatInBar).toBe(1)
    expect(beat1.msIntoBeat).toBeCloseTo(0)
    const beat3 = mustBeatAt(1600, 120, '4/4', anchors)
    expect(beat3.beatInBar).toBe(3)
    expect(beat3.msIntoBeat).toBeCloseTo(25) // 1600 - 3*525
  })
})

describe('beatAt - isCountIn (#25 follow-up)', () => {
  it('is always false with no anchors at all, matching the pre-anchor invariant', () => {
    for (const elapsedMs of [0, 500, 123456]) {
      expect(mustBeatAt(elapsedMs, 120, '4/4').isCountIn).toBe(false)
      expect(mustBeatAt(elapsedMs, 120, '4/4', [], 4).isCountIn).toBe(false) // countInBars is a no-op without anchors
    }
  })

  it('is always false when countInBars is 0, even with anchors - unchanged from before this feature', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 2100 }, { timeMs: 4200 }]
    expect(beatAt(0, 120, '4/4', anchors, 0)).toBeNull() // still a plain, silent count-in state
  })

  it('is true throughout the configured count-in window, false from the first anchor onward', () => {
    const anchors: BeatAnchorLike[] = [{ timeMs: 2100 }, { timeMs: 4200 }]
    expect(mustBeatAt(0, 120, '4/4', anchors, 1).isCountIn).toBe(true)
    expect(mustBeatAt(600, 120, '4/4', anchors, 1).isCountIn).toBe(true)
    expect(mustBeatAt(2100, 120, '4/4', anchors, 1).isCountIn).toBe(false) // the real first anchor itself
    expect(mustBeatAt(3000, 120, '4/4', anchors, 1).isCountIn).toBe(false)
  })
})

describe('upcomingBeats', () => {
  // 120 BPM = 500ms per beat throughout.

  it('lists only beats strictly after "now", never the one currently sounding', () => {
    // At elapsedMs exactly 500 (beat index 1 is sounding right now), a 150ms lookahead should
    // list only index 2 (at 1000ms), not re-list index 1.
    const beats = upcomingBeats(500, 150, 120, '4/4')
    expect(beats.map((b) => b.beatIndex)).toEqual([])
  })

  it('lists every beat index that falls within the lookahead window', () => {
    // From elapsedMs 0, a 1100ms lookahead covers beat indices 1 (500ms) and 2 (1000ms).
    const beats = upcomingBeats(0, 1100, 120, '4/4')
    expect(beats.map((b) => b.beatIndex)).toEqual([1, 2])
  })

  it('reports msFromNow relative to the given elapsedMs, not to song-start', () => {
    const beats = upcomingBeats(200, 400, 120, '4/4')
    // Beat index 1 sounds at 500ms; 300ms from an elapsedMs of 200.
    expect(beats).toEqual([{ beatIndex: 1, isDownbeat: false, msFromNow: 300 }])
  })

  it('marks the downbeat correctly per the time signature', () => {
    // 3/4: beat index 3 (1500ms) is the next downbeat after index 0.
    const beats = upcomingBeats(1400, 200, 120, '3/4')
    expect(beats).toEqual([{ beatIndex: 3, isDownbeat: true, msFromNow: 100 }])
  })

  it('returns nothing when the lookahead window is empty/negative', () => {
    expect(upcomingBeats(0, 0, 120, '4/4')).toEqual([])
  })

  it('is byte-identical to the pre-anchor formula when no anchors are given (the default)', () => {
    for (const elapsedMs of [0, 200, 500, 1400]) {
      expect(upcomingBeats(elapsedMs, 400, 120, '4/4')).toEqual(upcomingBeats(elapsedMs, 400, 120, '4/4', []))
    }
  })

  it('returns nothing before the first anchor, even if the anchor itself is within the lookahead window - a count-in state, not a peekable future beat (matches beatAt\'s null)', () => {
    // The anchor at 5000ms is only 100ms away, well inside a 150ms lookahead, but it hasn't
    // arrived yet - nothing should be scheduled until elapsedMs reaches it.
    expect(upcomingBeats(4900, 150, 120, '4/4', [{ timeMs: 5000 }])).toEqual([])
  })

  it('lists beats normally once elapsedMs has reached the anchor', () => {
    const beats = upcomingBeats(5000, 600, 120, '4/4', [{ timeMs: 5000 }])
    // Beat 0 is "now" (not upcoming); beat 1 at +500ms is the next one within the window.
    expect(beats).toEqual([{ beatIndex: 1, isDownbeat: false, msFromNow: 500 }])
  })
})

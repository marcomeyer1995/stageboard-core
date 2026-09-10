import { describe, expect, it } from 'vitest'
import { adjustedBpm, beatAt, beatsPerBar, type BeatAnchorLike, effectiveClickEnabled, resolveBeatOrigin, upcomingBeats } from './metronome'

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
    // 250ms after the second anchor is still beat 0 (250ms into a 500ms beat).
    const after = mustBeatAt(5400, 120, '4/4', anchors)
    expect(after.beatInBar).toBe(0)
    expect(after.msIntoBeat).toBeCloseTo(250)
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

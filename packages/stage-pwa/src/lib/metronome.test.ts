import { describe, expect, it } from 'vitest'
import { adjustedBpm, beatAt, beatsPerBar, effectiveClickEnabled, upcomingBeats } from './metronome'

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
    const beat = beatAt(0, 120, '4/4')
    expect(beat.beatInBar).toBe(0)
    expect(beat.isDownbeat).toBe(true)
    expect(beat.msIntoBeat).toBe(0)
  })

  // 120 BPM = 500ms per beat.
  it('advances one beat per 500ms at 120 BPM', () => {
    expect(beatAt(499, 120, '4/4').beatInBar).toBe(0)
    expect(beatAt(500, 120, '4/4').beatInBar).toBe(1)
    expect(beatAt(999, 120, '4/4').beatInBar).toBe(1)
    expect(beatAt(1000, 120, '4/4').beatInBar).toBe(2)
  })

  it('wraps back to the downbeat at the start of every bar, per the time signature', () => {
    // 4/4 at 120 BPM: bar is 2000ms, beat 4 (index 4) wraps to beatInBar 0.
    const beat = beatAt(2000, 120, '4/4')
    expect(beat.beatInBar).toBe(0)
    expect(beat.isDownbeat).toBe(true)
  })

  it('respects a non-4/4 time signature', () => {
    // 3/4 at 120 BPM: beat index 3 (1500ms) wraps to beatInBar 0.
    expect(beatAt(1500, 120, '3/4').beatInBar).toBe(0)
    expect(beatAt(1000, 120, '3/4').beatInBar).toBe(2)
  })

  it('reports how far into the current beat elapsedMs is', () => {
    const beat = beatAt(650, 120, '4/4')
    expect(beat.beatInBar).toBe(1)
    expect(beat.msIntoBeat).toBeCloseTo(150)
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
})

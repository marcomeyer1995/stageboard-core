import { describe, expect, it } from 'vitest'
import { beatAt, beatsPerBar } from './metronome'

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

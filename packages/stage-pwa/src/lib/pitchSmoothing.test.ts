import { describe, expect, it } from 'vitest'
import { medianFrequency, PitchHistory } from './pitchSmoothing'

describe('medianFrequency', () => {
  it('returns null for an empty set of readings', () => {
    expect(medianFrequency([])).toBeNull()
  })

  it('returns the middle value for an odd count', () => {
    expect(medianFrequency([440, 442, 438])).toBe(440)
  })

  it('averages the two middle values for an even count', () => {
    expect(medianFrequency([440, 442, 438, 444])).toBe(441)
  })

  it('is not dragged off by a single octave-error outlier', () => {
    // One frame misread as double the real frequency (a classic octave error).
    expect(medianFrequency([440, 441, 439, 440, 880])).toBe(440)
  })
})

describe('PitchHistory', () => {
  it('reports no smoothed value until enough readings have accumulated', () => {
    const history = new PitchHistory(8, 5)
    history.push(440)
    history.push(441)
    expect(history.smoothed(3)).toBeNull()
  })

  it('smooths out a single bad octave-error frame once enough readings exist', () => {
    const history = new PitchHistory(8, 5)
    for (const reading of [440, 441, 880, 439, 440]) history.push(reading)
    expect(history.smoothed(3)).toBe(440)
  })

  it('clears the window after enough consecutive misses (the note stopped)', () => {
    const history = new PitchHistory(8, 3)
    for (const reading of [440, 441, 439]) history.push(reading)
    history.push(null)
    history.push(null)
    history.push(null)
    expect(history.smoothed(1)).toBeNull()
  })

  it('does not clear the window on a single stray miss', () => {
    const history = new PitchHistory(8, 3)
    for (const reading of [440, 441, 439]) history.push(reading)
    history.push(null)
    expect(history.smoothed(1)).not.toBeNull()
  })

  it('keeps only the most recent `size` readings', () => {
    const history = new PitchHistory(3, 5)
    for (const reading of [440, 500, 440, 440]) history.push(reading)
    // The 500 outlier should have been pushed out of a window of size 3.
    expect(history.smoothed(1)).toBe(440)
  })
})

import { describe, expect, it } from 'vitest'
import { computePeaks } from './waveformPeaks'

describe('computePeaks', () => {
  it('keeps the min and max of every 10 ms bucket', () => {
    // 1 kHz sample rate: 10 samples per bucket.
    const samples = new Float32Array(25)
    samples[3] = 0.8
    samples[7] = -0.5
    samples[14] = -0.9
    samples[22] = 0.2
    const peaks = computePeaks(samples, 1000)
    expect(peaks.bucketMs).toBe(10)
    expect(Array.from(peaks.max)).toEqual([expect.closeTo(0.8), 0, expect.closeTo(0.2)])
    expect(Array.from(peaks.min)).toEqual([expect.closeTo(-0.5), expect.closeTo(-0.9), 0])
  })
})

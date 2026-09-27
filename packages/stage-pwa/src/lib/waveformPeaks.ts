/** Min/max of the samples per `bucketMs` - what the timeline's audio lane draws (docs/14). */
export interface WaveformPeaks {
  bucketMs: number
  min: Float32Array
  max: Float32Array
}

export function computePeaks(samples: Float32Array, sampleRate: number, bucketMs = 10): WaveformPeaks {
  const size = Math.max(1, Math.round((bucketMs / 1000) * sampleRate))
  const count = Math.ceil(samples.length / size)
  const min = new Float32Array(count)
  const max = new Float32Array(count)
  for (let b = 0; b < count; b++) {
    let lo = 0
    let hi = 0
    const end = Math.min(samples.length, (b + 1) * size)
    for (let i = b * size; i < end; i++) {
      const v = samples[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo
    max[b] = hi
  }
  return { bucketMs, min, max }
}

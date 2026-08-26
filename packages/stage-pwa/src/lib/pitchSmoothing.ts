/**
 * Median of a set of frequency readings - robust to an occasional octave-detection
 * error (autocorrelation pitch detection can lock onto a harmonic/subharmonic for one
 * frame even on a clean signal), unlike a mean, which one bad outlier can drag far off.
 */
export function medianFrequency(readings: number[]): number | null {
  if (readings.length === 0) return null
  const sorted = [...readings].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * A fixed-size rolling window of recent pitch readings, feeding the display a median
 * rather than each frame's raw (and sometimes wrong) detection - this is what stops the
 * tuner reading from jumping wildly between notes. `push(null)` (silence/no clear pitch
 * this frame) counts toward `misses`; enough consecutive misses means the note stopped
 * and the window should be dropped, not smoothed through as if it were still sounding.
 */
export class PitchHistory {
  private readings: number[] = []
  private misses = 0

  constructor(
    private readonly size: number = 8,
    private readonly maxMisses: number = 5,
  ) {}

  push(frequency: number | null): void {
    if (frequency === null) {
      this.misses++
      if (this.misses >= this.maxMisses) this.readings = []
      return
    }
    this.misses = 0
    this.readings.push(frequency)
    if (this.readings.length > this.size) this.readings.shift()
  }

  /** Null until enough readings have accumulated to trust a stable value. */
  smoothed(minReadings: number = 3): number | null {
    if (this.readings.length < minReadings) return null
    return medianFrequency(this.readings)
  }
}

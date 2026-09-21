import { describe, expect, it } from 'vitest'
import { computeSpectralFlux, detectOnsets } from './audioAnalysis'

const SAMPLE_RATE = 44_100

/** Silence with a short decaying tone burst at each `[timeMs, amplitude]` - a synthetic "attack". */
function withAttacks(durationMs: number, attacks: [number, number][], noise = 0): Float32Array {
  const samples = new Float32Array(Math.round((durationMs / 1000) * SAMPLE_RATE))
  let seed = 12345
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0xffffffff - 0.5
  }
  for (let i = 0; i < samples.length; i++) samples[i] = noise * random()
  for (const [timeMs, amplitude] of attacks) {
    const start = Math.round((timeMs / 1000) * SAMPLE_RATE)
    const length = Math.round(0.06 * SAMPLE_RATE)
    for (let n = 0; n < length && start + n < samples.length; n++) {
      samples[start + n]! += amplitude * Math.sin((2 * Math.PI * 440 * n) / SAMPLE_RATE) * Math.exp(-n / (0.012 * SAMPLE_RATE))
    }
  }
  return samples
}

const onsetTimes = (samples: Float32Array) => detectOnsets(computeSpectralFlux(samples, SAMPLE_RATE)).map((onset) => onset.timeMs)

describe('detectOnsets (#7)', () => {
  it('finds each attack close to where it happens', () => {
    const times = onsetTimes(withAttacks(5000, [[500, 0.8], [1500, 0.8], [2750, 0.8], [4000, 0.8]]))
    expect(times).toHaveLength(4)
    ;[500, 1500, 2750, 4000].forEach((expected, index) => expect(Math.abs(times[index]! - expected)).toBeLessThanOrEqual(45))
  })

  it('finds a soft attack next to a loud one (the threshold is local, not global)', () => {
    const times = onsetTimes(withAttacks(6000, [[500, 0.9], [3500, 0.12]]))
    expect(times.some((time) => Math.abs(time - 3500) <= 45)).toBe(true)
  })

  it('merges the smear of one attack into a single onset', () => {
    // Two bursts 20 ms apart are one attack to the ear.
    const times = onsetTimes(withAttacks(3000, [[1000, 0.8], [1020, 0.8]]))
    expect(times.filter((time) => Math.abs(time - 1000) <= 90)).toHaveLength(1)
  })

  it('does not report background noise as onsets', () => {
    expect(onsetTimes(withAttacks(4000, [[2000, 0.8]], 0.02)).filter((time) => Math.abs(time - 2000) > 90)).toHaveLength(0)
  })

  it('returns nothing for silence, and orders onsets in time with a strength above 1', () => {
    expect(detectOnsets(computeSpectralFlux(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE))).toEqual([])
    const onsets = detectOnsets(computeSpectralFlux(withAttacks(4000, [[3000, 0.8], [800, 0.8]]), SAMPLE_RATE))
    expect(onsets.map((onset) => onset.timeMs)).toEqual([...onsets.map((onset) => onset.timeMs)].sort((a, b) => a - b))
    for (const onset of onsets) expect(onset.strength).toBeGreaterThan(1)
  })
})

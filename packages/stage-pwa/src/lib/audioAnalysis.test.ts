import { describe, expect, it } from 'vitest'
import {
  computeOnsetStrength,
  computeRmsEnvelope,
  detectBeatAnchors,
  detectFirstOnset,
  detectTempo,
  lowPassFilter,
  type RmsEnvelope,
} from './audioAnalysis'

/** Builds a synthetic mono signal: silence everywhere except short sine bursts at each given
 * time (ms) - a stand-in for a click track/percussive backing track, with known ground-truth
 * onset positions to test detection against. `burstMs` defaults to 100ms - long enough to
 * reliably sustain across several RMS frames at the default 30ms frame/15ms hop (a very short,
 * purely impulsive click can fail to sustain for `minSustainFrames`, same as a real single
 * transient would - `detectFirstOnset`'s own dedicated test below uses a short burst
 * deliberately, to prove exactly that rejection). */
function syntheticSignal(sampleRate: number, totalMs: number, onsetTimesMs: number[], burstMs = 100, freq = 1000): Float32Array {
  const totalSamples = Math.round((totalMs / 1000) * sampleRate)
  const samples = new Float32Array(totalSamples)
  const burstSamples = Math.round((burstMs / 1000) * sampleRate)
  for (const t of onsetTimesMs) {
    const startSample = Math.round((t / 1000) * sampleRate)
    for (let i = 0; i < burstSamples && startSample + i < totalSamples; i++) {
      samples[startSample + i]! += Math.sin((2 * Math.PI * freq * i) / sampleRate)
    }
  }
  return samples
}

/** A regular click train at `intervalMs`, with an optional one-time permanent shift inserted
 * before `shiftAtIndex` (simulating a real, persistent irregularity - a fermata, an inserted
 * bar - not just one click moving and then snapping back). */
function clickTimes(leadInMs: number, intervalMs: number, count: number, shiftAtIndex = -1, shiftAmountMs = 0): number[] {
  const times: number[] = []
  let t = leadInMs
  for (let i = 0; i < count; i++) {
    if (i === shiftAtIndex) t += shiftAmountMs
    times.push(t)
    t += intervalMs
  }
  return times
}

const SAMPLE_RATE = 44100

describe('computeRmsEnvelope', () => {
  it('is silent (near-zero) before a constant-amplitude region starts, and matches its amplitude once fully inside it', () => {
    // 1000 samples/sec for simplicity (1 sample = 1ms) - 500ms silence, then 500ms at a
    // constant amplitude of 1.0 (not a sine, so RMS over a fully-inside frame is exactly 1.0,
    // no trigonometric averaging to hand-compute).
    const samples = new Float32Array(1000)
    for (let i = 500; i < 1000; i++) samples[i] = 1
    const envelope = computeRmsEnvelope(samples, 1000)
    expect(envelope.hopMs).toBe(15)
    expect(envelope.rms[0]).toBe(0)
    expect(envelope.rms[10]).toBe(0) // frame fully within the silent region
    const lastFrame = envelope.rms[envelope.rms.length - 1]!
    expect(lastFrame).toBeCloseTo(1, 5) // frame fully within the constant region
  })

  it('produces one frame for input shorter than a single frame, not zero', () => {
    const envelope = computeRmsEnvelope(new Float32Array(5), 1000)
    expect(envelope.rms.length).toBe(1)
  })

  it('is empty for empty input', () => {
    expect(computeRmsEnvelope(new Float32Array(0), 1000).rms.length).toBe(0)
  })
})

describe('computeOnsetStrength', () => {
  it('is the half-wave-rectified frame-to-frame RMS increase - zero on a decay, positive on a rise', () => {
    const envelope: RmsEnvelope = { rms: Float32Array.from([0, 0, 1, 1, 0.5, 0.5, 0.9]), hopMs: 15 }
    const strength = computeOnsetStrength(envelope)
    const expected = [0, 0, 1, 0, 0, 0, 0.4]
    Array.from(strength).forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 5))
  })

  it('is all zero for a steady or silent signal', () => {
    const steady: RmsEnvelope = { rms: Float32Array.from([0.5, 0.5, 0.5, 0.5]), hopMs: 15 }
    expect(Array.from(computeOnsetStrength(steady))).toEqual([0, 0, 0, 0])
  })
})

describe('detectFirstOnset', () => {
  it('finds the onset shortly after a lead-in, within a couple of frames (the windowed RMS frame can slightly precede the true onset by design)', () => {
    const samples = syntheticSignal(SAMPLE_RATE, 5000, [800])
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    const onset = detectFirstOnset(envelope)
    expect(onset).not.toBeNull()
    expect(Math.abs(onset!.onsetMs - 800)).toBeLessThanOrEqual(30)
  })

  it('finds an onset starting at elapsedMs 0 (no lead-in at all)', () => {
    const samples = syntheticSignal(SAMPLE_RATE, 5000, [0])
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    const onset = detectFirstOnset(envelope)
    expect(onset).not.toBeNull()
    expect(onset!.onsetMs).toBe(0)
  })

  it('is null for pure silence', () => {
    const envelope = computeRmsEnvelope(new Float32Array(Math.round(2 * SAMPLE_RATE)), SAMPLE_RATE)
    expect(detectFirstOnset(envelope)).toBeNull()
  })

  it('rejects a single-frame transient that never sustains (minSustainFrames)', () => {
    // A single 8ms burst - too short to hold the RMS above threshold for 3 consecutive
    // 15ms-hop frames, the same way a single click/room-noise spike shouldn't count as "the
    // song has started."
    const samples = syntheticSignal(SAMPLE_RATE, 3000, [500], 8)
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    expect(detectFirstOnset(envelope)).toBeNull()
  })
})

describe('detectTempo', () => {
  // Quantization from the 15ms hop means the recovered bpm is never exact for an arbitrary
  // tempo (verified via a small node simulation mirroring this exact code, not hand
  // arithmetic) - a few bpm of tolerance is expected and fine, the result is always shown to
  // the user in an editable field afterward.
  const cases: Array<[nominalBpm: number, toleranceBpm: number]> = [
    [120, 3],
    [80, 1],
    [140, 3],
    [174, 1],
  ]
  for (const [bpm, tolerance] of cases) {
    it(`recovers close to ${bpm} BPM from a regular click train at that tempo`, () => {
      const intervalMs = 60000 / bpm
      const samples = syntheticSignal(SAMPLE_RATE, 20000, clickTimes(500, intervalMs, Math.floor(19500 / intervalMs)))
      const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
      const result = detectTempo(computeOnsetStrength(envelope), envelope.hopMs)
      expect(result).not.toBeNull()
      expect(Math.abs(result!.bpm - bpm)).toBeLessThanOrEqual(tolerance)
    })
  }

  it('prefers a half/double-lag candidate landing in the typical 90-140 BPM band over an out-of-band raw best lag', () => {
    // A perfectly regular 200 BPM click train's raw autocorrelation peak IS 200 BPM (every
    // click is identical, nothing distinguishes odd/even ones) - but 200 is outside the
    // "typical" band while its half-tempo, 100 BPM, is comfortably inside it and still a
    // strong secondary correlation peak (every other beat of a 200 BPM train IS a valid 100
    // BPM beat), so the heuristic prefers it.
    const samples = syntheticSignal(SAMPLE_RATE, 20000, clickTimes(500, 300, 60))
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    const result = detectTempo(computeOnsetStrength(envelope), envelope.hopMs)
    expect(result?.bpm).toBe(100)
  })

  it('is null when there is not enough signal to correlate at all (shorter than the lag range)', () => {
    expect(detectTempo(new Float32Array(5), 15)).toBeNull()
  })
})

describe('detectBeatAnchors', () => {
  it('returns just the first-onset anchor for a fully clean, perfectly-on-grid track - no spurious corrections', () => {
    const times = clickTimes(500, 500, 20)
    const samples = syntheticSignal(SAMPLE_RATE, 11000, times)
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    const onsetStrength = computeOnsetStrength(envelope)
    const firstOnset = detectFirstOnset(envelope)
    expect(detectBeatAnchors(onsetStrength, envelope.hopMs, 120, firstOnset!.onsetMs)).toEqual([{ timeMs: 480 }])
  })

  it('adds exactly one correction anchor at a genuine, persistent shift - not before and not a duplicate after', () => {
    // Same clean 120 BPM click train, but from beat index 10 onward every click is
    // permanently 150ms later than the nominal grid (a fermata/inserted beat, not a
    // one-off blip) - the exact "a bar that didn't line up with straight bpm-math" scenario
    // a beat anchor is meant to correct, same as this session's earlier manual-anchor tests.
    const times = clickTimes(500, 500, 20, 10, 150)
    const samples = syntheticSignal(SAMPLE_RATE, 11000, times)
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    const onsetStrength = computeOnsetStrength(envelope)
    const firstOnset = detectFirstOnset(envelope)
    expect(detectBeatAnchors(onsetStrength, envelope.hopMs, 120, firstOnset!.onsetMs)).toEqual([
      { timeMs: 480 },
      { timeMs: 5625 },
    ])
  })

  it('tolerates a genuinely missing beat (no click at all) without adding a spurious anchor, since nothing else in the track actually moved', () => {
    const times = clickTimes(500, 500, 20).filter((_, i) => i !== 10)
    const samples = syntheticSignal(SAMPLE_RATE, 11000, times)
    const envelope = computeRmsEnvelope(samples, SAMPLE_RATE)
    const onsetStrength = computeOnsetStrength(envelope)
    const firstOnset = detectFirstOnset(envelope)
    expect(detectBeatAnchors(onsetStrength, envelope.hopMs, 120, firstOnset!.onsetMs)).toEqual([{ timeMs: 480 }])
  })

  it('falls back to just the lead-in anchor when the input is too unreliable to track at all (safety net)', () => {
    // Pure white noise, no periodic structure whatsoever - would otherwise produce a correction
    // at nearly every predicted beat (exactly what happened live, 2026-09-10: 113 anchors on
    // one real song). A deterministic PRNG, not Math.random(), so this test is reproducible.
    let seed = 7
    function rng() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const onsetStrength = Float32Array.from({ length: 2000 }, () => rng())
    expect(detectBeatAnchors(onsetStrength, 15, 120, 100)).toEqual([{ timeMs: 100 }])
  })
})

describe('lowPassFilter', () => {
  it('strongly attenuates a high-frequency tone relative to a low-frequency one of the same amplitude', () => {
    const sampleRate = 44100
    const durationSamples = 4410 // 100ms
    const low = Float32Array.from({ length: durationSamples }, (_, i) => Math.sin((2 * Math.PI * 80 * i) / sampleRate))
    const high = Float32Array.from({ length: durationSamples }, (_, i) => Math.sin((2 * Math.PI * 4000 * i) / sampleRate))

    function rms(samples: Float32Array): number {
      let sum = 0
      for (const s of samples) sum += s * s
      return Math.sqrt(sum / samples.length)
    }

    const lowFiltered = lowPassFilter(low, sampleRate)
    const highFiltered = lowPassFilter(high, sampleRate)
    // The low tone survives close to its original loudness; the high tone is knocked down
    // dramatically - the whole point (isolating kick/bass content from hi-hats/cymbals).
    expect(rms(lowFiltered)).toBeGreaterThan(rms(low) * 0.7)
    expect(rms(highFiltered)).toBeLessThan(rms(high) * 0.1)
  })

  it('is a no-op-shaped passthrough for pure silence', () => {
    expect(Array.from(lowPassFilter(new Float32Array(100), 44100))).toEqual(Array.from(new Float32Array(100)))
  })
})

describe('detectBeatAnchors - robustness against a realistic noisy full mix', () => {
  it('locks onto the true (low-frequency) beat and ignores frequent higher-frequency noise, once low-pass filtered', () => {
    // A regular 120 BPM kick drum (80Hz) plus frequent hi-hat-like noise (4000Hz, roughly 4x
    // per beat, jittered) at comparable or louder amplitude - a stand-in for a real full mix,
    // where naive "loudest nearby transient" picking is dominated by the noise, not the beat
    // (found live, 2026-09-10, see detectBeatAnchors' own doc comment).
    const sampleRate = 44100
    const totalMs = 15000
    const leadInMs = 500
    const intervalMs = 500 // 120 BPM
    const totalSamples = Math.round((totalMs / 1000) * sampleRate)
    const mix = new Float32Array(totalSamples)

    function addBurst(tMs: number, freq: number, amp: number, burstMs: number) {
      const startSample = Math.round((tMs / 1000) * sampleRate)
      const burstSamples = Math.round((burstMs / 1000) * sampleRate)
      for (let i = 0; i < burstSamples && startSample + i < totalSamples && startSample + i >= 0; i++) {
        const decay = Math.exp(-i / (burstSamples * 0.3))
        mix[startSample + i]! += amp * decay * Math.sin((2 * Math.PI * freq * i) / sampleRate)
      }
    }

    for (let t = leadInMs; t < totalMs; t += intervalMs) addBurst(t, 80, 1.0, 120)

    let seed = 42
    function rng() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let t = leadInMs; t < totalMs; t += intervalMs / 4) addBurst(t + (rng() - 0.5) * 40, 4000, 0.8 + rng() * 0.4, 15)

    const filtered = lowPassFilter(mix, sampleRate)
    const envelope = computeRmsEnvelope(filtered, sampleRate)
    const onsetStrength = computeOnsetStrength(envelope)
    const firstOnset = detectFirstOnset(envelope)
    expect(firstOnset).not.toBeNull()

    const anchors = detectBeatAnchors(onsetStrength, envelope.hopMs, 120, firstOnset!.onsetMs)
    // Just the lead-in anchor - the noise never causes a spurious correction once filtered.
    expect(anchors).toEqual([{ timeMs: 480 }])
  })
})

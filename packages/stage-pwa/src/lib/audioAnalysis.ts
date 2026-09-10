/**
 * Pure, hand-written audio-analysis DSP (#25 follow-up: automatic BPM + beat-anchor detection) -
 * no third-party DSP dependency, matching this codebase's existing convention (clickEngine.ts/
 * localAudioEngine.ts are both hand-written against native Web Audio). Deliberately takes plain
 * Float32Array/number inputs rather than an AudioContext/AudioBuffer, so every function here is
 * directly unit-testable with synthetic signals - the AudioContext/decodeAudioData glue lives in
 * analyzeTrack.ts instead, mirroring how metronome.ts (pure, tested) stays separate from
 * clickEngine.ts (thin AudioContext glue).
 */

/**
 * In-place radix-2 Cooley-Tukey FFT - `re`/`im` must be equal-length power-of-2 arrays (`im`
 * conventionally all-zero for a real-valued input signal). The building block for
 * `computeSpectralFlux` below; not exported, since no caller needs a raw FFT for its own sake.
 */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curWr = 1
      let curWi = 0
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j]!
        const ui = im[i + j]!
        const vr = re[i + j + len / 2]! * curWr - im[i + j + len / 2]! * curWi
        const vi = re[i + j + len / 2]! * curWi + im[i + j + len / 2]! * curWr
        re[i + j] = ur + vr
        im[i + j] = ui + vi
        re[i + j + len / 2] = ur - vr
        im[i + j + len / 2] = ui - vi
        const nextWr = curWr * wr - curWi * wi
        const nextWi = curWr * wi + curWi * wr
        curWr = nextWr
        curWi = nextWi
      }
    }
  }
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export interface SpectralFluxEnvelope {
  /** Already an onset-strength-shaped signal in its own right (unlike a raw loudness envelope,
   * which would still need a separate frame-to-frame diff step) - a sharp peak wherever the
   * mix's *spectral content* changed abruptly, not just wherever it got louder. */
  flux: Float32Array
  hopMs: number
}

/**
 * Spectral flux onset-strength envelope: for each frame, a windowed FFT's magnitude spectrum is
 * compared to the previous frame's, and the positive (rising) part of that difference is summed
 * across all frequency bins. Replaces an earlier RMS-loudness-difference approach entirely
 * (found live, 2026-09-10, after three rounds of tuning that raw loudness-based technique still
 * couldn't reliably tell a real full mix's beat from its own hi-hats/vocals/strums): comparing
 * *which frequencies* changed, not just overall volume, is what actually distinguishes a new
 * note starting from an existing note simply ringing on or the whole mix swelling - the standard
 * technique real onset detectors use, not a home-grown approximation of it. `frameSize` is
 * rounded up to the next power of two for the FFT; time-based `hopMs` (not sample counts), so
 * this stays sample-rate independent like the rest of this module.
 */
export function computeSpectralFlux(samples: Float32Array, sampleRate: number, frameSize = 1024, hopMs = 15): SpectralFluxEnvelope {
  const fftSize = nextPowerOfTwo(frameSize)
  const hopSize = Math.max(1, Math.round((hopMs / 1000) * sampleRate))
  const frameCount = samples.length === 0 ? 0 : Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1)
  const flux = new Float32Array(frameCount)

  // A Hann window - tapers each frame's edges to near-zero before the FFT, so a note that
  // happens to straddle a frame boundary doesn't produce spurious high-frequency energy purely
  // from the frame being chopped off mid-waveform (spectral leakage).
  const window = new Float64Array(fftSize)
  for (let i = 0; i < fftSize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1))

  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const prevMagnitude = new Float64Array(fftSize / 2)

  for (let i = 0; i < frameCount; i++) {
    const start = i * hopSize
    for (let j = 0; j < fftSize; j++) {
      const sampleIndex = start + j
      re[j] = (sampleIndex < samples.length ? samples[sampleIndex]! : 0) * window[j]!
      im[j] = 0
    }
    fft(re, im)
    let sumFlux = 0
    for (let bin = 0; bin < fftSize / 2; bin++) {
      const magnitude = Math.sqrt(re[bin]! * re[bin]! + im[bin]! * im[bin]!)
      sumFlux += Math.max(0, magnitude - prevMagnitude[bin]!)
      prevMagnitude[bin] = magnitude
    }
    flux[i] = sumFlux
  }
  return { flux, hopMs }
}

export interface OnsetDetectionResult {
  onsetMs: number
  confidenceRatio: number
}

/**
 * The first real onset in the track - the song's actual first downbeat, roughly (exact phase is
 * refined by `detectBeatAnchors`' own beat-tracking, which always starts from this point).
 * Noise floor = 10th percentile flux over the first ~2s; threshold = max(noiseFloor * 3,
 * peak * 0.1) - robust to both a hissy analog transfer and a truly digital-silent lead-in, and
 * (verified live, 2026-09-10, against a synthetic quiet-blip-then-real-onset signal) already
 * enough on its own to ignore a genuinely quiet false transient well below the track's real
 * peak level, with no extra "sustained for N frames" requirement needed. Deliberately just a
 * single-frame threshold crossing, not a sustain check (an earlier version required
 * `minSustainFrames` consecutive frames above threshold, carried over from an RMS-loudness-based
 * design where a note "staying loud" was meaningful - found live, 2026-09-10: spectral flux is
 * inherently a peaky, derivative-like signal, not a sustained one - even a real, deliberately
 * decaying musical onset only shows one or two elevated frames, since flux only registers
 * *ongoing* spectral change and a note's magnitude spectrum stops changing much once its attack
 * is over. Requiring sustain against a signal that's supposed to spike and then drop rejected
 * genuine onsets outright). `null` for effectively silent input.
 */
export function detectFirstOnset(envelope: SpectralFluxEnvelope): OnsetDetectionResult | null {
  const { flux, hopMs } = envelope
  if (flux.length === 0) return null

  const noiseWindowFrames = Math.max(1, Math.min(flux.length, Math.round(2000 / hopMs)))
  const noiseWindow = Array.from(flux.slice(0, noiseWindowFrames)).sort((a, b) => a - b)
  const noiseFloor = noiseWindow[Math.floor(noiseWindow.length * 0.1)] ?? 0
  const peak = Math.max(...flux)
  if (peak <= 0) return null // effectively silent throughout

  const threshold = Math.max(noiseFloor * 3, peak * 0.1)

  for (let i = 0; i < flux.length; i++) {
    if (flux[i]! > threshold) {
      return { onsetMs: i * hopMs, confidenceRatio: flux[i]! / threshold }
    }
  }
  return null
}

export interface TempoDetectionResult {
  bpm: number
  confidence: number
}

/**
 * Autocorrelates the onset-strength envelope over the lag range for `minBpm`-`maxBpm` (default
 * 60-200); the best-correlating lag becomes `bpm = 60000 / (lag * hopMs)`. Octave-ambiguity
 * mitigation: if the autocorrelation at half or double the best lag is comparably strong (within
 * 60%) AND lands in the "typical" 90-140 BPM band, prefer it over the raw best lag - a
 * heuristic, acceptable since the result is always shown to the user before it's saved
 * (SheetEditor's bpm field stays fully editable either way). A perfectly regular click train
 * (every beat spectrally identical) can genuinely correlate *more* strongly at a sub-harmonic
 * than at the true tempo - hop-quantization alone can tip the balance a few percent either way
 * (verified live, 2026-09-10, against a synthetic 140 BPM click train: raw best lag came back
 * ~70 BPM at 69% relative strength) - 60% (not the tighter 70% first tried) is what actually
 * catches that case without being so loose it overrides a genuinely-correct raw answer instead.
 * `null` when there isn't enough signal to correlate at all.
 */
export function detectTempo(
  onsetStrength: Float32Array,
  hopMs: number,
  options: { minBpm?: number; maxBpm?: number } = {},
): TempoDetectionResult | null {
  const minBpm = options.minBpm ?? 60
  const maxBpm = options.maxBpm ?? 200
  const minLag = Math.max(1, Math.round(60000 / maxBpm / hopMs))
  const maxLag = Math.max(minLag + 1, Math.round(60000 / minBpm / hopMs))
  if (onsetStrength.length <= maxLag) return null

  function autocorrelationAt(lag: number): number {
    let sum = 0
    for (let i = 0; i + lag < onsetStrength.length; i++) sum += onsetStrength[i]! * onsetStrength[i + lag]!
    return sum
  }

  let bestLag = -1
  let bestValue = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = autocorrelationAt(lag)
    if (value > bestValue) {
      bestValue = value
      bestLag = lag
    }
  }
  if (bestLag <= 0 || bestValue <= 0) return null

  const typicalMinBpm = 90
  const typicalMaxBpm = 140
  let chosenLag = bestLag
  for (const lag of [bestLag * 2, Math.round(bestLag / 2)]) {
    if (lag < minLag || lag > maxLag) continue
    const value = autocorrelationAt(lag)
    const bpm = 60000 / (lag * hopMs)
    if (value >= bestValue * 0.6 && bpm >= typicalMinBpm && bpm <= typicalMaxBpm) {
      chosenLag = lag
      break
    }
  }

  const chosenValue = chosenLag === bestLag ? bestValue : autocorrelationAt(chosenLag)
  return { bpm: 60000 / (chosenLag * hopMs), confidence: Math.min(1, chosenValue / bestValue) }
}

/** The nearest *clearly standing-out* onset peak to `centerMs`, within `windowMs` either side -
 * one at least `minPeakProminence` above the window's own mean strength, not just whichever
 * frame happens to be the loudest. `null` if nothing in the window qualifies. */
function findQualifyingPeak(
  onsetStrength: Float32Array,
  hopMs: number,
  centerMs: number,
  windowMs: number,
  minPeakProminence: number,
): number | null {
  const windowStartFrame = Math.max(0, Math.round((centerMs - windowMs) / hopMs))
  const windowEndFrame = Math.min(onsetStrength.length - 1, Math.round((centerMs + windowMs) / hopMs))
  let peakFrame = -1
  let peakValue = 0
  let sum = 0
  for (let f = windowStartFrame; f <= windowEndFrame; f++) {
    const value = onsetStrength[f]!
    sum += value
    if (value > peakValue) {
      peakValue = value
      peakFrame = f
    }
  }
  const windowMean = sum / Math.max(1, windowEndFrame - windowStartFrame + 1)
  if (peakFrame === -1 || peakValue < windowMean * minPeakProminence) return null
  return peakFrame * hopMs
}

/**
 * Full-track beat-tracking scan: starting from `firstOnsetMs` (`detectFirstOnset`'s result, the
 * anchor that lets the click start at the real first downbeat at all - always the first entry
 * returned here), follows a constant-`bpm` grid forward one beat at a time via
 * `findQualifyingPeak`. A qualifying peak within `driftToleranceRatio` (default 0.15) of a
 * beat's length from the prediction needs no correction. No qualifying peak near a predicted
 * beat at all (a sustained note, a quiet passage, syncopation) keeps the existing prediction and
 * continues; after `maxConsecutiveMisses` (default 8) predicted beats in a row with no
 * qualifying peak, scanning stops - avoids drifting into noise across a long ambient/
 * instrumental outro.
 *
 * A peak further off than that is only committed as a correction anchor if the *following* beat
 * also lands on-grid relative to it (found live, 2026-09-10, against a real, human - not
 * click-tracked - band recording: without this confirmation step, ordinary performance looseness
 * of a hundred-plus ms around the math grid - completely normal for a live take - looked
 * identical to a genuine tempo/phase shift, since a single loosely-played note and a real,
 * sustained shift both start with one beat landing off the strict grid. Requiring the *next*
 * beat to also confirm the new position is what tells them apart: a one-off loose note reverts
 * to the old grid on the very next beat, while a real shift (a dropped/added beat, a tempo
 * hiccup, a fermata) persists - directly matching what a manual tap-to-resync would produce for
 * the same irregularity, and only for that).
 *
 * As a last-resort safety net beyond tuning any of the above: if corrections still end up
 * needed for more than 1 in every 6 beats scanned, the input clearly isn't reliable enough for
 * this technique at all (a heavily distorted recording, a mislabeled bpm) - rather than hand
 * back a still-jumpy result, this falls back to just the lead-in anchor alone, which is always
 * correct and still useful on its own.
 */
export function detectBeatAnchors(
  onsetStrength: Float32Array,
  hopMs: number,
  bpm: number,
  firstOnsetMs: number,
  options: { driftToleranceRatio?: number; maxConsecutiveMisses?: number; minPeakProminence?: number } = {},
): { timeMs: number }[] {
  const driftToleranceRatio = options.driftToleranceRatio ?? 0.15
  const maxConsecutiveMisses = options.maxConsecutiveMisses ?? 8
  // Tuned against spectral flux's own value distribution (found live, 2026-09-10: the 2x
  // default carried over from an earlier RMS-based envelope was too strict here and silently
  // gave up after covering barely 15% of a real song - flux values vary more across "typical"
  // frames than RMS-diff did, so a lower bar still reliably rejects genuine noise).
  const minPeakProminence = options.minPeakProminence ?? 1.5
  const beatMs = 60000 / bpm
  const onGridToleranceMs = beatMs * driftToleranceRatio
  // Proportional to the on-grid tolerance (not an independent fixed ratio) - widening the
  // tolerance alone without also widening this would make it structurally impossible to ever
  // find a peak far enough away to actually need a correction.
  const searchWindowMs = onGridToleranceMs * 1.5
  const totalMs = onsetStrength.length * hopMs

  const anchors: { timeMs: number }[] = [{ timeMs: firstOnsetMs }]
  let originMs = firstOnsetMs
  let beatIndex = 1
  let consecutiveMisses = 0
  let beatsScanned = 0
  let correctionsAdded = 0

  while (originMs + beatIndex * beatMs <= totalMs) {
    const predictedMs = originMs + beatIndex * beatMs
    const peakMs = findQualifyingPeak(onsetStrength, hopMs, predictedMs, searchWindowMs, minPeakProminence)
    beatsScanned++

    if (peakMs === null) {
      consecutiveMisses++
      if (consecutiveMisses >= maxConsecutiveMisses) break
      beatIndex++
      continue
    }
    consecutiveMisses = 0

    if (Math.abs(peakMs - predictedMs) <= onGridToleranceMs) {
      beatIndex++
      continue
    }

    // Off grid - only commit if the *next* beat, predicted from this candidate, also confirms
    // it; otherwise treat this one beat as ordinary performance looseness and keep the old grid.
    const nextPredictedMs = peakMs + beatMs
    const nextPeakMs = findQualifyingPeak(onsetStrength, hopMs, nextPredictedMs, searchWindowMs, minPeakProminence)
    const confirmed = nextPeakMs !== null && Math.abs(nextPeakMs - nextPredictedMs) <= onGridToleranceMs
    if (confirmed) {
      anchors.push({ timeMs: peakMs })
      correctionsAdded++
      originMs = peakMs
      beatIndex = 1
    } else {
      beatIndex++
    }
  }

  if (beatsScanned > 12 && correctionsAdded > beatsScanned / 6) {
    return [{ timeMs: firstOnsetMs }]
  }
  return anchors
}

/**
 * Pure, hand-written audio-analysis DSP (#25 follow-up: automatic BPM + beat-anchor detection) -
 * no third-party DSP dependency, matching this codebase's existing convention (clickEngine.ts/
 * localAudioEngine.ts are both hand-written against native Web Audio). Deliberately takes plain
 * Float32Array/number inputs rather than an AudioContext/AudioBuffer, so every function here is
 * directly unit-testable with synthetic signals - the AudioContext/decodeAudioData glue lives in
 * analyzeTrack.ts instead, mirroring how metronome.ts (pure, tested) stays separate from
 * clickEngine.ts (thin AudioContext glue).
 */

export interface RmsEnvelope {
  rms: Float32Array
  hopMs: number
}

/**
 * Windowed RMS loudness envelope - the shared basis for onset/tempo/anchor detection below.
 * Time-based frame/hop (not sample counts), so it's sample-rate independent.
 */
export function computeRmsEnvelope(samples: Float32Array, sampleRate: number, frameMs = 30, hopMs = 15): RmsEnvelope {
  const frameSize = Math.max(1, Math.round((frameMs / 1000) * sampleRate))
  const hopSize = Math.max(1, Math.round((hopMs / 1000) * sampleRate))
  const frameCount = samples.length === 0 ? 0 : Math.max(1, Math.floor((samples.length - frameSize) / hopSize) + 1)
  const rms = new Float32Array(frameCount)
  for (let i = 0; i < frameCount; i++) {
    const start = i * hopSize
    const end = Math.min(start + frameSize, samples.length)
    let sumSquares = 0
    for (let j = start; j < end; j++) sumSquares += samples[j]! * samples[j]!
    rms[i] = Math.sqrt(sumSquares / Math.max(1, end - start))
  }
  return { rms, hopMs }
}

/**
 * Onset-strength envelope: half-wave-rectified frame-to-frame RMS increase - sharp peaks at note
 * onsets (a decay, or a steady tone, produces nothing, since it's rectified to >= 0). Shared by
 * both `detectTempo` and `detectBeatAnchors` below, computed once by analyzeTrack.ts.
 */
export function computeOnsetStrength(envelope: RmsEnvelope): Float32Array {
  const { rms } = envelope
  const strength = new Float32Array(rms.length)
  for (let i = 1; i < rms.length; i++) {
    strength[i] = Math.max(0, rms[i]! - rms[i - 1]!)
  }
  return strength
}

export interface OnsetDetectionResult {
  onsetMs: number
  confidenceRatio: number
}

/**
 * The first real onset in the track - the song's actual first downbeat, roughly (exact phase is
 * refined by `detectBeatAnchors`' own beat-tracking, which always starts from this point).
 * Noise floor = 10th percentile RMS over the first ~2s; threshold = max(noiseFloor * 3,
 * peak * 0.1) - robust to both a hissy analog transfer and a truly digital-silent lead-in. First
 * frame exceeding it for `minSustainFrames` (default 3, ~45ms at the default hop) consecutive
 * frames counts - rejecting a single-transient false positive (a click, a room-noise spike).
 * `null` for effectively silent input.
 */
export function detectFirstOnset(envelope: RmsEnvelope, options: { minSustainFrames?: number } = {}): OnsetDetectionResult | null {
  const { rms, hopMs } = envelope
  const minSustainFrames = options.minSustainFrames ?? 3
  if (rms.length === 0) return null

  const noiseWindowFrames = Math.max(1, Math.min(rms.length, Math.round(2000 / hopMs)))
  const noiseWindow = Array.from(rms.slice(0, noiseWindowFrames)).sort((a, b) => a - b)
  const noiseFloor = noiseWindow[Math.floor(noiseWindow.length * 0.1)] ?? 0
  const peak = Math.max(...rms)
  if (peak <= 0) return null // effectively silent throughout

  const threshold = Math.max(noiseFloor * 3, peak * 0.1)

  let sustainCount = 0
  for (let i = 0; i < rms.length; i++) {
    if (rms[i]! > threshold) {
      sustainCount++
      if (sustainCount >= minSustainFrames) {
        const onsetIndex = i - minSustainFrames + 1
        return { onsetMs: onsetIndex * hopMs, confidenceRatio: rms[i]! / threshold }
      }
    } else {
      sustainCount = 0
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
 * 70%) AND lands in the "typical" 90-140 BPM band, prefer it over the raw best lag - a
 * heuristic, acceptable since the result is always shown to the user before it's saved
 * (SheetEditor's bpm field stays fully editable either way). `null` when there isn't enough
 * signal to correlate at all.
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
    if (value >= bestValue * 0.7 && bpm >= typicalMinBpm && bpm <= typicalMaxBpm) {
      chosenLag = lag
      break
    }
  }

  const chosenValue = chosenLag === bestLag ? bestValue : autocorrelationAt(chosenLag)
  return { bpm: 60000 / (chosenLag * hopMs), confidence: Math.min(1, chosenValue / bestValue) }
}

/**
 * Full-track beat-tracking scan: starting from `firstOnsetMs` (`detectFirstOnset`'s result, the
 * anchor that lets the click start at the real first downbeat at all - always the first entry
 * returned here), follows a constant-`bpm` grid forward one beat at a time, searching a window
 * around each predicted beat position for the nearest onset peak. A peak within
 * `driftToleranceRatio` (default 0.15) of a beat's length from the prediction needs no
 * correction; one further off (but still within the wider search net) becomes a new anchor and
 * the grid re-baselines from it - directly matching what a manual tap-to-resync would produce
 * for the same irregularity (a dropped/added beat, a tempo hiccup). No onset found near a
 * predicted beat at all (a sustained note, a quiet passage, syncopation) keeps the existing
 * prediction and continues; after `maxConsecutiveMisses` (default 8) predicted beats in a row
 * with no nearby onset, scanning stops - avoids drifting into noise across a long ambient/
 * instrumental outro.
 */
export function detectBeatAnchors(
  onsetStrength: Float32Array,
  hopMs: number,
  bpm: number,
  firstOnsetMs: number,
  options: { driftToleranceRatio?: number; maxConsecutiveMisses?: number } = {},
): { timeMs: number }[] {
  const driftToleranceRatio = options.driftToleranceRatio ?? 0.15
  const maxConsecutiveMisses = options.maxConsecutiveMisses ?? 8
  const beatMs = 60000 / bpm
  const onGridToleranceMs = beatMs * driftToleranceRatio
  // A generous search net, deliberately wider than onGridToleranceMs - otherwise any peak found
  // would always be "on grid" by construction (it could never be found outside its own search
  // window), and a genuinely shifted beat could never be flagged as needing a correction anchor.
  const searchWindowMs = beatMs * 0.4
  const totalMs = onsetStrength.length * hopMs

  const anchors: { timeMs: number }[] = [{ timeMs: firstOnsetMs }]
  let originMs = firstOnsetMs
  let beatIndex = 1
  let consecutiveMisses = 0

  while (originMs + beatIndex * beatMs <= totalMs) {
    const predictedMs = originMs + beatIndex * beatMs
    const windowStartFrame = Math.max(0, Math.round((predictedMs - searchWindowMs) / hopMs))
    const windowEndFrame = Math.min(onsetStrength.length - 1, Math.round((predictedMs + searchWindowMs) / hopMs))

    let peakFrame = -1
    let peakValue = 0
    for (let f = windowStartFrame; f <= windowEndFrame; f++) {
      if (onsetStrength[f]! > peakValue) {
        peakValue = onsetStrength[f]!
        peakFrame = f
      }
    }

    if (peakFrame === -1) {
      consecutiveMisses++
      if (consecutiveMisses >= maxConsecutiveMisses) break
      beatIndex++
      continue
    }
    consecutiveMisses = 0
    const peakMs = peakFrame * hopMs
    if (Math.abs(peakMs - predictedMs) > onGridToleranceMs) {
      anchors.push({ timeMs: peakMs })
      originMs = peakMs
      beatIndex = 1
    } else {
      beatIndex++
    }
  }

  return anchors
}

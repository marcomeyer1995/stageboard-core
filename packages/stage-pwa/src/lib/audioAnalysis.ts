/**
 * Pure, hand-written audio-analysis DSP (#25 follow-up: automatic BPM + beat-anchor detection) -
 * no third-party DSP dependency, matching this codebase's existing convention (clickEngine.ts/
 * localAudioEngine.ts are both hand-written against native Web Audio). Deliberately takes plain
 * Float32Array/number inputs rather than an AudioContext/AudioBuffer, so every function here is
 * directly unit-testable with synthetic signals - the AudioContext/decodeAudioData glue lives in
 * analyzeTrack.ts instead, mirroring how metronome.ts (pure, tested) stays separate from
 * clickEngine.ts (thin AudioContext glue).
 */
import { beatsPerBar } from './metronome'

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

export interface DetectedOnset {
  timeMs: number
  /** How far this peak stands above the flux around it (peak / local mean) - 1 is "no more than
   * its surroundings", larger is a sharper, more clearly audible attack. */
  strength: number
}

export interface OnsetPeakOptions {
  /** A peak must exceed the local mean flux by this factor. Default 1.8. */
  ratio?: number
  /** Width of the window the local mean is taken over, either side. Default 600 ms. */
  localWindowMs?: number
  /** Peaks closer than this are one onset (the stronger wins). Default 60 ms. */
  minSeparationMs?: number
  /** Peaks below this fraction of the track's loudest peak are noise. Default 0.05. */
  minPeakFraction?: number
}

/**
 * Every onset-like peak in the envelope, in time order (#7) - not just the first one
 * (`detectFirstOnset`) or one per beat (`detectBeatAnchors`), but the full set a cue can be
 * snapped to. A frame counts when it is a local maximum, clearly above the flux around it (an
 * *adaptive* threshold, so a quiet verse's soft attacks still register next to a loud chorus),
 * and above a small fraction of the track's loudest peak (so pure noise never does). Peaks
 * closer together than `minSeparationMs` collapse to the stronger one - a single strum smears
 * across a few frames.
 *
 * Deliberately generous: it returns candidates, and whoever snaps to them decides how far to
 * trust one (`strength`). Times use the same `frame * hopMs` convention as `detectFirstOnset`.
 */
export function detectOnsets(envelope: SpectralFluxEnvelope, options: OnsetPeakOptions = {}): DetectedOnset[] {
  const { flux, hopMs } = envelope
  const ratio = options.ratio ?? 1.8
  const halfWindow = Math.max(1, Math.round((options.localWindowMs ?? 600) / hopMs))
  const minSeparationFrames = Math.max(1, Math.round((options.minSeparationMs ?? 60) / hopMs))
  // Frame 0 has no previous frame to differ from, so its "flux" is just the whole first spectrum -
  // an artifact, never an onset, and it must not set the noise floor either.
  let peak = 0
  for (let i = 1; i < flux.length; i++) peak = Math.max(peak, flux[i]!)
  if (peak <= 0) return []
  const floor = peak * (options.minPeakFraction ?? 0.05)

  // Prefix sums make each local mean O(1).
  const prefix = new Float64Array(flux.length + 1)
  for (let i = 0; i < flux.length; i++) prefix[i + 1] = prefix[i]! + flux[i]!

  const onsets: (DetectedOnset & { frame: number })[] = []
  for (let i = 1; i < flux.length; i++) {
    const value = flux[i]!
    if (value < floor) continue
    if (value < flux[i - 1]!) continue
    if (i < flux.length - 1 && value <= flux[i + 1]!) continue
    const from = Math.max(0, i - halfWindow)
    const to = Math.min(flux.length, i + halfWindow + 1)
    const localMean = (prefix[to]! - prefix[from]!) / (to - from)
    if (value <= localMean * ratio) continue
    const candidate = { timeMs: i * hopMs, strength: value / Math.max(localMean, 1e-12), frame: i }
    const previous = onsets[onsets.length - 1]
    if (previous && candidate.frame - previous.frame < minSeparationFrames) {
      if (candidate.strength > previous.strength) onsets[onsets.length - 1] = candidate
    } else {
      onsets.push(candidate)
    }
  }
  return onsets.map(({ timeMs, strength }) => ({ timeMs, strength }))
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
 *
 * Every returned anchor also carries `beatInBar`, counting continuously from 0 at `firstOnsetMs`
 * regardless of how many corrections land in between (a miss or an on-grid beat still advances
 * the count by one beat-slot, same as a committed correction does) - this is what lets a dense
 * result still cycle 1-2-3-4 through the bar instead of every anchor re-announcing "beat 1"
 * (metronome.ts/clickEngine.ts's `originBeatInBar`). There is no way to detect which beat is
 * *actually* the downbeat from audio alone (no tool available here does this reliably - see
 * `beatInBar`'s own schema doc comment), so this is a starting assumption the user can correct
 * via the anchor list editor's "Beat" selector if `firstOnsetMs` wasn't really beat 1.
 */
export function detectBeatAnchors(
  onsetStrength: Float32Array,
  hopMs: number,
  bpm: number,
  timeSignature: string,
  firstOnsetMs: number,
  options: { driftToleranceRatio?: number; maxConsecutiveMisses?: number; minPeakProminence?: number } = {},
): { timeMs: number; beatInBar: number }[] {
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
  const beatCount = beatsPerBar(timeSignature)

  const anchors: { timeMs: number; beatInBar: number }[] = [{ timeMs: firstOnsetMs, beatInBar: 0 }]
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
      // `beatsScanned` already counts this beat-slot (incremented above, before this check) -
      // i.e. exactly how many beats have elapsed since firstOnsetMs, whether they were on-grid,
      // missed, or corrected. That's the continuous count `beatInBar` needs.
      anchors.push({ timeMs: peakMs, beatInBar: beatsScanned % beatCount })
      correctionsAdded++
      originMs = peakMs
      beatIndex = 1
    } else {
      beatIndex++
    }
  }

  if (beatsScanned > 12 && correctionsAdded > beatsScanned / 6) {
    return [{ timeMs: firstOnsetMs, beatInBar: 0 }]
  }
  return anchors
}

/**
 * Tempo-map suggestion (#141 follow-up): detectTempo() above finds one global tempo for a whole
 * track, by design - a genuine mid-song tempo change needs the equivalent of tracking tempo
 * *as a function of time*, not a single number. This is deliberately a *suggestion* a musician
 * reviews before trusting, exactly like detectBeatAnchors' anchors already are - automatically
 * detecting a real tempo change is a much harder, less certain problem than detecting one fixed
 * tempo (see this feature's own history: an early attempt naively re-ran detectTempo per time
 * window, which is fooled by octave ambiguity - a window can score a candidate's *double* just
 * as well as the true tempo whenever the music has real subdivisions - and once locked onto the
 * wrong octave near the start of a track, plain continuity-based smoothing perpetuates it
 * through the whole track. This still has that failure mode on metrically-ambiguous material
 * (a slow ballad with a strong 2-beat feel can come back at exactly double its real tempo) -
 * verified live against real commercial recordings, not just synthetic click tracks - which is
 * exactly why the caller must never silently apply this without the musician checking it by ear
 * first, the same way an auto-detected bpm/beatAnchors already work.
 */
export interface TempoMapResult {
  /** Suggested tempo for the very start of the track (segment 0) - SheetEditor treats this like
   * detectTempo's own bpm result: a suggestion to review, not an authoritative overwrite. */
  baseBpm: number
  /** Suggested tempoMarkers for every place the tempo path settles onto a materially different,
   * sustained value - ordered by time, ready to feed straight into a SongVariant's own
   * `tempoMarkers` field once reviewed (still needs its own `id` assigned by the caller). */
  tempoMarkers: { timeMs: number; bpm: number }[]
}

/** Local-maxima-above-threshold onset picker - unlike `detectFirstOnset` (the track's very
 * first onset only) or `findQualifyingPeak` (nearest peak to one predicted position), this
 * lists every qualifying onset across a whole range, which `detectTempoMap`'s per-window
 * profiling and changepoint refinement both need. Not exported: on its own it's a much cruder
 * primitive than `detectBeatAnchors`' actual beat-tracking (no tempo-grid awareness at all,
 * just "loud enough and locally the biggest for a bit"), useful here only as raw material for
 * the coverage/refinement math below, not as a general-purpose onset detector callers should
 * reach for directly. */
function pickOnsetPeaks(flux: Float32Array, hopMs: number, minSpacingMs = 100): number[] {
  const noiseWindowFrames = Math.max(1, Math.min(flux.length, Math.round(2000 / hopMs)))
  const noiseWindow = Array.from(flux.slice(0, noiseWindowFrames)).sort((a, b) => a - b)
  const noiseFloor = noiseWindow[Math.floor(noiseWindow.length * 0.1)] ?? 0
  const peak = Math.max(...flux)
  if (peak <= 0) return []
  const threshold = Math.max(noiseFloor * 3, peak * 0.1)
  const minSpacingFrames = Math.max(1, Math.round(minSpacingMs / hopMs))

  const onsets: number[] = []
  let lastOnsetFrame = -Infinity
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i]! <= threshold) continue
    if (flux[i]! < flux[i - 1]! || flux[i]! < flux[i + 1]!) continue
    if (i - lastOnsetFrame < minSpacingFrames) continue
    onsets.push(i * hopMs)
    lastOnsetFrame = i
  }
  return onsets
}

/** How well a beat grid at `beatMs` (anchored at the earliest onset) explains a set of real
 * onsets, in both directions - the minimum of "does every predicted beat have a nearby onset"
 * (catches a candidate that's too slow: real onsets exist between its widely-spaced
 * predictions) and "does every onset have a nearby predicted beat" (catches a candidate that's
 * too fast: its denser grid predicts beats nothing corresponds to) is what actually
 * distinguishes those from the true tempo; either direction alone doesn't - a too-fast
 * candidate can still score ~100% on the first check alone (every real onset happens to be
 * *a* predicted beat, just with extra unmatched predictions in between). */
function onsetGridCoverage(onsetsMs: number[], beatMs: number, toleranceMs: number): number {
  const start = onsetsMs[0]!
  const end = onsetsMs[onsetsMs.length - 1]!

  let gridTotal = 0
  let gridCovered = 0
  for (let t = start; t <= end + beatMs / 2; t += beatMs) {
    gridTotal++
    if (onsetsMs.some((o) => Math.abs(o - t) <= toleranceMs)) gridCovered++
  }
  const gridCoverage = gridTotal > 0 ? gridCovered / gridTotal : 0

  let onsetCovered = 0
  for (const o of onsetsMs) {
    const nearestGridIndex = Math.round((o - start) / beatMs)
    const nearestGridMs = start + nearestGridIndex * beatMs
    if (Math.abs(o - nearestGridMs) <= toleranceMs) onsetCovered++
  }
  const onsetCoverage = onsetCovered / onsetsMs.length

  return Math.min(gridCoverage, onsetCoverage)
}

function buildBpmGrid(minBpm: number, maxBpm: number, stepBpm: number): number[] {
  const grid: number[] = []
  for (let b = minBpm; b <= maxBpm; b += stepBpm) grid.push(b)
  return grid
}

interface TempoWindowProfile {
  atMs: number
  /** Coverage score per `bpmGrid` entry, or `null` if this window had too few onsets to score
   * at all (silence, an extremely sparse passage) - the DP below treats a `null` profile as "no
   * opinion this window" (a zero emission term), letting continuity alone carry the tempo path
   * across the gap instead of forcing a decision from noise. */
  scores: number[] | null
}

/** A coverage-vs-bpm profile *per time window*, all on one shared bpm grid so every window's
 * evidence is directly comparable - this (not a single best-guess bpm per window) is what makes
 * the joint optimization in `decodeTempoPath` possible at all, since Viterbi/DP needs a shared
 * state space across time steps. */
function computeTempoWindowProfiles(
  flux: Float32Array,
  hopMs: number,
  windowMs: number,
  stepMs: number,
  bpmGrid: number[],
  minOnsets = 6,
): TempoWindowProfile[] {
  const windowFrames = Math.round(windowMs / hopMs)
  const stepFrames = Math.max(1, Math.round(stepMs / hopMs))
  const profiles: TempoWindowProfile[] = []
  for (let start = 0; start + windowFrames <= flux.length; start += stepFrames) {
    const slice = flux.slice(start, start + windowFrames)
    const onsets = pickOnsetPeaks(slice, hopMs)
    const atMs = (start + windowFrames / 2) * hopMs
    if (onsets.length < minOnsets) {
      profiles.push({ atMs, scores: null })
      continue
    }
    const scores = bpmGrid.map((bpm) => onsetGridCoverage(onsets, 60000 / bpm, (60000 / bpm) * 0.15))
    profiles.push({ atMs, scores })
  }
  return profiles
}

/**
 * Viterbi/DP over (window x bpmGrid) - a genuine joint optimization across the whole track, not
 * a greedy per-window or continuity-only decision. Finds the single bpm-over-time path that
 * best explains *all* the windows' onset evidence together, where switching tempo costs
 * something proportional to how big the jump is (in log-bpm, so a given ratio costs the same
 * whether jumping up from a slow or fast base) but is never forbidden outright - if enough
 * consecutive windows' evidence favors a jump strongly enough to outweigh paying that one-time
 * cost, the path takes it, genuine near-2x change or not (this is what a plain "lock onto
 * whatever the last window decided" continuity heuristic can't do - it either flickers on noise
 * or never budges from an initial wrong octave, one or the other). A `null`-profile window
 * contributes no emission term at all, so continuity alone carries the path across a gap rather
 * than forcing a decision from a window with too little signal to have an opinion.
 */
function decodeTempoPath(profiles: TempoWindowProfile[], bpmGrid: number[], transitionWeight: number): number[] {
  const n = profiles.length
  const V = bpmGrid.length
  const logGrid = bpmGrid.map((b) => Math.log(b))

  const dp: Float64Array[] = Array.from({ length: n }, () => new Float64Array(V))
  const back: Int32Array[] = Array.from({ length: n }, () => new Int32Array(V))

  const firstScores = profiles[0]!.scores ?? new Array<number>(V).fill(0)
  for (let v = 0; v < V; v++) dp[0]![v] = firstScores[v]!

  for (let i = 1; i < n; i++) {
    const scores = profiles[i]!.scores ?? new Array<number>(V).fill(0)
    const prevDp = dp[i - 1]!
    for (let v = 0; v < V; v++) {
      let best = -Infinity
      let bestPrev = 0
      for (let pv = 0; pv < V; pv++) {
        const cost = transitionWeight * Math.abs(logGrid[v]! - logGrid[pv]!)
        const candidate = prevDp[pv]! - cost
        if (candidate > best) {
          best = candidate
          bestPrev = pv
        }
      }
      dp[i]![v] = best + scores[v]!
      back[i]![v] = bestPrev
    }
  }

  let bestFinal = 0
  let bestVal = -Infinity
  const lastDp = dp[n - 1]!
  for (let v = 0; v < V; v++) {
    if (lastDp[v]! > bestVal) {
      bestVal = lastDp[v]!
      bestFinal = v
    }
  }
  const path = new Array<number>(n)
  path[n - 1] = bestFinal
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i]![path[i]!]!
  return path.map((idx) => bpmGrid[idx]!)
}

/** Walks the globally-optimized tempo path end to end, returning every run of `stabilityCount`
 * or more consecutive windows that agree within `agreeRatio` - a real section-tempo stays
 * stable far longer than ordinary human timing variation or a brief fill/section-boundary blip
 * can sustain, so this (not the raw per-window path) is what a caller should treat as "the
 * track's actual tempo sections." */
function findTempoPlateaus(
  path: number[],
  stabilityCount: number,
  agreeRatio: number,
): { startIndex: number; endIndex: number; bpm: number }[] {
  function findFrom(from: number): { startIndex: number; endIndex: number; bpm: number } | null {
    for (let i = from; i + stabilityCount <= path.length; i++) {
      const group = path.slice(i, i + stabilityCount)
      const sorted = [...group].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]!
      if (group.every((bpm) => Math.abs(bpm - median) / median <= agreeRatio)) {
        return { startIndex: i, endIndex: i + stabilityCount - 1, bpm: median }
      }
    }
    return null
  }
  const plateaus: { startIndex: number; endIndex: number; bpm: number }[] = []
  let from = 0
  while (from < path.length) {
    const plateau = findFrom(from)
    if (!plateau) break
    let end = plateau.endIndex
    while (end + 1 < path.length && Math.abs(path[end + 1]! - plateau.bpm) / plateau.bpm <= agreeRatio) end++
    plateaus.push({ ...plateau, endIndex: end })
    from = end + 1
  }
  return plateaus
}

/** Pinpoints a changepoint's actual ms within the coarse gap between two plateaus, via discrete
 * onset peak-picking + consecutive-interval matching against each side's known bpm - much
 * higher time resolution than one 8-second analysis window, and safe to trust here because the
 * plateaus on either side already established roughly where and what the two tempos are. Falls
 * back to the gap's midpoint if no clean onset-interval crossing is found (a sparse passage
 * right at the boundary). */
function refineChangepointMs(
  flux: Float32Array,
  hopMs: number,
  bracketStartMs: number,
  bracketEndMs: number,
  bpmBefore: number,
  bpmAfter: number,
  marginMs = 3000,
): number {
  const startFrame = Math.max(0, Math.round((bracketStartMs - marginMs) / hopMs))
  const endFrame = Math.min(flux.length, Math.round((bracketEndMs + marginMs) / hopMs))
  const slice = flux.slice(startFrame, endFrame)
  const onsets = pickOnsetPeaks(slice, hopMs).map((ms) => ms + startFrame * hopMs)

  const expectedBeforeMs = 60000 / bpmBefore
  const expectedAfterMs = 60000 / bpmAfter

  for (let i = 1; i < onsets.length; i++) {
    const gap = onsets[i]! - onsets[i - 1]!
    const closerToAfter = Math.abs(gap - expectedAfterMs) < Math.abs(gap - expectedBeforeMs)
    if (closerToAfter && Math.abs(gap - expectedAfterMs) / expectedAfterMs < 0.2) {
      return onsets[i - 1]!
    }
  }
  return (bracketStartMs + bracketEndMs) / 2
}

/**
 * Suggests a tempo-map for a whole track: a base tempo plus every place it later settles onto a
 * materially different, sustained tempo. `null` when the track is too sparse/quiet throughout
 * to find even one stable tempo section (silence, or nothing rhythmically clear enough to
 * analyze) - the caller should leave any existing bpm/tempoMarkers untouched in that case, same
 * as `detectTempo` returning `null`.
 */
export function detectTempoMap(flux: Float32Array, hopMs: number): TempoMapResult | null {
  const bpmGrid = buildBpmGrid(40, 220, 1)
  const profiles = computeTempoWindowProfiles(flux, hopMs, 8000, 1000, bpmGrid)
  if (profiles.every((p) => p.scores === null)) return null

  const path = decodeTempoPath(profiles, bpmGrid, 4)
  const atMsByIndex = profiles.map((p) => p.atMs)
  const plateaus = findTempoPlateaus(path, 20, 0.03)
  if (plateaus.length === 0) return null

  const baseBpm = plateaus[0]!.bpm
  const tempoMarkers: { timeMs: number; bpm: number }[] = []
  for (let i = 1; i < plateaus.length; i++) {
    const before = plateaus[i - 1]!
    const after = plateaus[i]!
    const jumpRatio = Math.abs(after.bpm - before.bpm) / before.bpm
    // Lower than a single-window jump threshold would need: a ~20s+ stable plateau on each
    // side is already the main defense against false positives (ordinary expressive timing
    // can't sustain agreement that long), so two such plateaus differing even modestly likely
    // reflects a real musical shift - and a gradual multi-step accelerando's individual steps
    // can each be well under a higher threshold despite adding up to a large genuine change.
    if (jumpRatio < 0.05) continue
    const bracketStartMs = atMsByIndex[before.endIndex]!
    const bracketEndMs = atMsByIndex[after.startIndex]!
    const refinedMs = refineChangepointMs(flux, hopMs, bracketStartMs, bracketEndMs, before.bpm, after.bpm)
    tempoMarkers.push({ timeMs: Math.round(refinedMs), bpm: after.bpm })
  }
  return { baseBpm, tempoMarkers }
}

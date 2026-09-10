import { computeOnsetStrength, computeRmsEnvelope, detectBeatAnchors, detectFirstOnset, detectTempo, lowPassFilter } from './audioAnalysis'

export interface TrackAnalysisResult {
  bpm: number | null
  beatAnchors: { timeMs: number }[]
  tempoConfidence: number
}

/** Mixes every channel down to mono by simple averaging - beat/onset detection only needs
 * overall loudness, not stereo image. */
function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < buffer.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels
  }
  return mono
}

/**
 * Decodes a backing track and runs the full automatic-detection pipeline (#25 follow-up) -
 * SheetEditor.tsx's "Track analysieren" button. Thin AudioContext/decodeAudioData glue around
 * audioAnalysis.ts's pure DSP functions, not meaningfully unit-testable itself (happy-dom has no
 * real decodeAudioData, the same limitation clickEngine.test.ts already works around by faking
 * only the scheduling surface) - needs live verification against real tracks instead.
 *
 * Deliberately uses TWO different envelopes for two different jobs (found live, 2026-09-10:
 * running tempo detection on the same low-passed/kick-only signal that fixed anchor placement
 * made the *tempo* estimate badly wrong - 75.5 vs. the correct ~114 BPM, a 2:3 ratio - because
 * isolating just the bassline exposed its own sparser sub-pattern instead of the true beat).
 * `detectTempo` uses the full-spectrum envelope: aggregate energy across the whole mix (kick,
 * snare, hi-hats, vocals) reinforces the *true* periodicity over many cycles far more robustly
 * than any single isolated instrument does, even though any one full-spectrum onset by itself is
 * noisy. `detectFirstOnset`/`detectBeatAnchors` use the low-passed envelope instead: isolating
 * the cleanest, most reliable individual transient (the kick/bass pulse) matters far more than
 * data volume for pinpointing exactly *where* one specific beat falls (the earlier, `#25`
 * follow-up problem - a full-spectrum "loudest nearby transient" was constantly fooled by
 * hi-hats/vocals/strums into adding a correction anchor almost every beat).
 *
 * `bpm: null` (with an empty `beatAnchors`) means the track was too quiet/silent throughout to
 * find even a first onset - nothing to suggest at all, SheetEditor leaves the existing bpm/
 * anchors untouched. A detected first onset but no confident tempo still returns that one anchor
 * alone (the lead-in point is still useful even without a bpm suggestion) - `bpm: null` in that
 * case too, so the caller knows not to overwrite the authored bpm.
 */
export async function analyzeTrackBlob(blob: Blob): Promise<TrackAnalysisResult> {
  const arrayBuffer = await blob.arrayBuffer()
  // A scratch instance, not clickEngine.ts's shared one - this runs once per analysis, wholly
  // unrelated to click playback, and must not interfere with it if a click happens to be running.
  const ctx = new AudioContext()
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    const mono = mixToMono(audioBuffer)

    const fullEnvelope = computeRmsEnvelope(mono, audioBuffer.sampleRate)
    const fullOnsetStrength = computeOnsetStrength(fullEnvelope)

    const filtered = lowPassFilter(mono, audioBuffer.sampleRate)
    const filteredEnvelope = computeRmsEnvelope(filtered, audioBuffer.sampleRate)
    const filteredOnsetStrength = computeOnsetStrength(filteredEnvelope)

    const firstOnset = detectFirstOnset(filteredEnvelope)
    if (firstOnset === null) return { bpm: null, beatAnchors: [], tempoConfidence: 0 }

    const tempo = detectTempo(fullOnsetStrength, fullEnvelope.hopMs)
    if (tempo === null) {
      return { bpm: null, beatAnchors: [{ timeMs: Math.round(firstOnset.onsetMs) }], tempoConfidence: 0 }
    }

    const bpm = Math.round(tempo.bpm * 10) / 10 // 1 decimal - matches VisualMetronomeWidget's display precision
    const beatAnchors = detectBeatAnchors(filteredOnsetStrength, filteredEnvelope.hopMs, bpm, firstOnset.onsetMs)
    return {
      bpm,
      beatAnchors: beatAnchors.map((a) => ({ timeMs: Math.round(a.timeMs) })),
      tempoConfidence: tempo.confidence,
    }
  } finally {
    void ctx.close()
  }
}

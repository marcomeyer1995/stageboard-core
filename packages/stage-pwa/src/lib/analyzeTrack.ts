import { computeOnsetStrength, computeRmsEnvelope, detectBeatAnchors, detectFirstOnset, detectTempo } from './audioAnalysis'

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
    const envelope = computeRmsEnvelope(mono, audioBuffer.sampleRate)
    const onsetStrength = computeOnsetStrength(envelope)

    const firstOnset = detectFirstOnset(envelope)
    if (firstOnset === null) return { bpm: null, beatAnchors: [], tempoConfidence: 0 }

    const tempo = detectTempo(onsetStrength, envelope.hopMs)
    if (tempo === null) {
      return { bpm: null, beatAnchors: [{ timeMs: Math.round(firstOnset.onsetMs) }], tempoConfidence: 0 }
    }

    const bpm = Math.round(tempo.bpm * 10) / 10 // 1 decimal - matches VisualMetronomeWidget's display precision
    const beatAnchors = detectBeatAnchors(onsetStrength, envelope.hopMs, bpm, firstOnset.onsetMs)
    return {
      bpm,
      beatAnchors: beatAnchors.map((a) => ({ timeMs: Math.round(a.timeMs) })),
      tempoConfidence: tempo.confidence,
    }
  } finally {
    void ctx.close()
  }
}

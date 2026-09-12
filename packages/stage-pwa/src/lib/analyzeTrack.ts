import { computeSpectralFlux, detectBeatAnchors, detectFirstOnset, detectTempo } from './audioAnalysis'
import type { MusicTempoWorkerRequest, MusicTempoWorkerResponse } from './musicTempoWorker'

export interface TrackAnalysisResult {
  bpm: number | null
  beatAnchors: { timeMs: number; beatInBar: number }[]
  tempoConfidence: number
}

/** `'hand-rolled'` (default): audioAnalysis.ts's always-available spectral-flux detector, no
 * extra dependency. `'music-tempo'`: the optional `music-tempo-beat-detection` plugin
 * (musicTempoAnalysis.ts) - only ever passed in once SheetEditor.tsx has confirmed that plugin
 * is installed+enabled for the current workspace (CAPABILITIES.audioAnalysis); manual tap-to-sync
 * needs neither and always works regardless of which provider (or none) is installed. */
export type AnalysisProvider = 'hand-rolled' | 'music-tempo'

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
 * Runs analyzeWithMusicTempo in a dedicated Web Worker (see musicTempoWorker.ts's own doc
 * comment) instead of directly on the main thread - a real, full-length song's worth of
 * synchronous Beatroot computation froze the entire app for 80+ seconds, confirmed live against
 * the real Stage-Server, 2026-09-12. `mono`'s underlying buffer is transferred, not copied
 * (a multi-minute track's samples can be tens of MB) - `mono` itself is unusable in this scope
 * afterward, which is fine, since the hand-rolled path never runs in the same call.
 */
function runMusicTempoInWorker(mono: Float32Array, sampleRate: number, timeSignature: string): Promise<TrackAnalysisResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./musicTempoWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<MusicTempoWorkerResponse>) => {
      worker.terminate()
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    const request: MusicTempoWorkerRequest = { mono, sampleRate, timeSignature }
    worker.postMessage(request, [mono.buffer])
  })
}

/**
 * Decodes a backing track and runs the full automatic-detection pipeline (#25 follow-up) -
 * SheetEditor.tsx's "Track analysieren" button. Thin AudioContext/decodeAudioData glue around
 * audioAnalysis.ts's pure DSP functions, not meaningfully unit-testable itself (happy-dom has no
 * real decodeAudioData, the same limitation clickEngine.test.ts already works around by faking
 * only the scheduling surface) - needs live verification against real tracks instead.
 *
 * One spectral-flux envelope serves every step below (found live, 2026-09-10: an earlier
 * RMS-loudness-based approach needed a low-pass-filtered *second* envelope just to keep anchor
 * placement from being fooled by hi-hats/vocals/strums, at the cost of nearly breaking tempo
 * detection the same way - isolating just the bassline exposed its own sparser sub-pattern
 * instead of the true beat, 75.5 vs. the correct ~114 BPM. Spectral flux - comparing *which
 * frequencies* changed, not just overall loudness - is inherently far more selective than raw
 * loudness ever was, verified directly against a real, previously-broken recording: the exact
 * same full-spectrum signal now serves tempo detection AND precise per-beat placement, with no
 * separate filtered copy needed at all).
 *
 * `bpm: null` (with an empty `beatAnchors`) means the track was too quiet/silent throughout to
 * find even a first onset - nothing to suggest at all, SheetEditor leaves the existing bpm/
 * anchors untouched. A detected first onset but no confident tempo still returns that one anchor
 * alone (the lead-in point is still useful even without a bpm suggestion) - `bpm: null` in that
 * case too, so the caller knows not to overwrite the authored bpm.
 */
export async function analyzeTrackBlob(
  blob: Blob,
  timeSignature: string,
  provider: AnalysisProvider = 'hand-rolled',
): Promise<TrackAnalysisResult> {
  const arrayBuffer = await blob.arrayBuffer()
  // A scratch instance, not clickEngine.ts's shared one - this runs once per analysis, wholly
  // unrelated to click playback, and must not interfere with it if a click happens to be running.
  const ctx = new AudioContext()
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    const mono = mixToMono(audioBuffer)

    if (provider === 'music-tempo') {
      return await runMusicTempoInWorker(mono, audioBuffer.sampleRate, timeSignature)
    }

    const envelope = computeSpectralFlux(mono, audioBuffer.sampleRate)

    const firstOnset = detectFirstOnset(envelope)
    if (firstOnset === null) return { bpm: null, beatAnchors: [], tempoConfidence: 0 }

    const tempo = detectTempo(envelope.flux, envelope.hopMs)
    if (tempo === null) {
      return {
        bpm: null,
        beatAnchors: [{ timeMs: Math.round(firstOnset.onsetMs), beatInBar: 0 }],
        tempoConfidence: 0,
      }
    }

    const bpm = Math.round(tempo.bpm * 10) / 10 // 1 decimal - matches VisualMetronomeWidget's display precision
    const beatAnchors = detectBeatAnchors(envelope.flux, envelope.hopMs, bpm, timeSignature, firstOnset.onsetMs)
    return {
      bpm,
      beatAnchors: beatAnchors.map((a) => ({ timeMs: Math.round(a.timeMs), beatInBar: a.beatInBar })),
      tempoConfidence: tempo.confidence,
    }
  } finally {
    void ctx.close()
  }
}

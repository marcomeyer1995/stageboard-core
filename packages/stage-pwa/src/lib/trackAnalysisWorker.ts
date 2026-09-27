import { computeSpectralFlux, detectOnsets } from './audioAnalysis'
import { computePeaks } from './waveformPeaks'

export interface TrackAnalysisWorkerRequest {
  mono: Float32Array
  sampleRate: number
}

export type TrackAnalysisWorkerResponse =
  | { ok: true; peaksMin: Float32Array; peaksMax: Float32Array; bucketMs: number; onsetsMs: number[]; durationMs: number }
  | { ok: false; error: string }

/**
 * The timeline editor's per-track analysis (docs/14) off the main thread: waveform peaks and
 * onsets (the same spectral-flux detector the Cue Recorder snaps to), so opening the timeline
 * never freezes the tablet. One request per worker, like musicTempoWorker.ts.
 */
self.onmessage = (event: MessageEvent<TrackAnalysisWorkerRequest>) => {
  try {
    const { mono, sampleRate } = event.data
    const peaks = computePeaks(mono, sampleRate)
    const onsets = detectOnsets(computeSpectralFlux(mono, sampleRate))
    const response: TrackAnalysisWorkerResponse = {
      ok: true,
      peaksMin: peaks.min,
      peaksMax: peaks.max,
      bucketMs: peaks.bucketMs,
      onsetsMs: onsets.map((o) => Math.round(o.timeMs)),
      durationMs: (mono.length / sampleRate) * 1000,
    }
    self.postMessage(response, { transfer: [peaks.min.buffer, peaks.max.buffer] })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies TrackAnalysisWorkerResponse)
  }
}

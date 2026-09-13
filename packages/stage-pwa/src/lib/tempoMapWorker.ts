import { computeSpectralFlux, detectTempoMap } from './audioAnalysis'
import type { TempoMapResult } from './audioAnalysis'

export interface TempoMapWorkerRequest {
  mono: Float32Array
  sampleRate: number
}

export type TempoMapWorkerResponse = { ok: true; result: TempoMapResult | null } | { ok: false; error: string }

/**
 * Dedicated Web Worker entry point for detectTempoMap - same reasoning as musicTempoWorker.ts's
 * own doc comment: this runs a windowed analysis (dozens to hundreds of 8-second windows for a
 * full-length song, each scored against a ~180-value bpm grid) plus a Viterbi decode over all of
 * them together, and a real song's worth of that on the main thread is exactly the kind of
 * synchronous work that froze the app for 80+ seconds when music-tempo did it there instead
 * (2026-09-12) - not worth risking again for a computation that, unlike that one, has no
 * external library forcing it onto the main thread's module graph either way.
 */
self.addEventListener('message', (event: MessageEvent<TempoMapWorkerRequest>) => {
  const { mono, sampleRate } = event.data
  try {
    const envelope = computeSpectralFlux(mono, sampleRate)
    const result = detectTempoMap(envelope.flux, envelope.hopMs)
    const response: TempoMapWorkerResponse = { ok: true, result }
    self.postMessage(response)
  } catch (err) {
    const response: TempoMapWorkerResponse = { ok: false, error: err instanceof Error ? err.message : String(err) }
    self.postMessage(response)
  }
})

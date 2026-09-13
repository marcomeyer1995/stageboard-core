import { analyzeWithMusicTempo } from './musicTempoAnalysis'
import type { TrackAnalysisResult } from './analyzeTrack'

export interface MusicTempoWorkerRequest {
  mono: Float32Array
  sampleRate: number
  timeSignature: string
}

export type MusicTempoWorkerResponse = { ok: true; result: TrackAnalysisResult } | { ok: false; error: string }

/**
 * Dedicated Web Worker entry point for analyzeWithMusicTempo (see its own doc comment for why
 * this must never run on the main thread) - spawned by analyzeTrack.ts via Vite's native
 * `new Worker(new URL(...))` pattern, which also code-splits this file's whole module graph
 * (including `music-tempo` itself) into its own chunk, same as the plain dynamic-import approach
 * this replaced. One request per worker instance - analyzeTrack.ts terminates it after the
 * response arrives, rather than keeping it around for reuse; a single "Track analysieren" click
 * is rare enough that the ~launch overhead of a fresh worker each time is not worth the
 * complexity of a persistent pool.
 *
 * `self` is typed as `Window` here (this file compiles under the app's DOM-lib tsconfig, not a
 * separate webworker-lib one) - `addEventListener('message', ...)` and the single-argument
 * `postMessage(data)` overload both exist on `Window` too, so this typechecks without needing a
 * dedicated worker tsconfig, even though at runtime `self` is really a `DedicatedWorkerGlobalScope`.
 */
self.addEventListener('message', (event: MessageEvent<MusicTempoWorkerRequest>) => {
  const { mono, sampleRate, timeSignature } = event.data
  analyzeWithMusicTempo(mono, sampleRate, timeSignature)
    .then((result) => {
      const response: MusicTempoWorkerResponse = { ok: true, result }
      self.postMessage(response)
    })
    .catch((err: unknown) => {
      const response: MusicTempoWorkerResponse = { ok: false, error: err instanceof Error ? err.message : String(err) }
      self.postMessage(response)
    })
})

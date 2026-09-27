import { getTrack } from './songVariantsDb'
import type { TrackAnalysisWorkerResponse } from './trackAnalysisWorker'
import type { WaveformPeaks } from './waveformPeaks'

/** Everything the timeline editor needs from a track (docs/14). */
export interface TrackAnalysis {
  peaks: WaveformPeaks
  onsetsMs: number[]
  durationMs: number
}

/** Bump when the analysis changes, so stale cache entries are recomputed. */
const VERSION = 1
const DB_NAME = 'stageboard-timeline-cache'
const STORE = 'analysis'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readCache(key: string): Promise<TrackAnalysis | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve((request.result as TrackAnalysis | undefined) ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function writeCache(key: string, value: TrackAnalysis): Promise<void> {
  try {
    const db = await openDb()
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key)
  } catch {
    // A cache that can't be written just means recomputing next time.
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < buffer.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels
  }
  return mono
}

function analyzeInWorker(mono: Float32Array, sampleRate: number): Promise<TrackAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./trackAnalysisWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<TrackAnalysisWorkerResponse>) => {
      worker.terminate()
      const data = event.data
      if (!data.ok) {
        reject(new Error(data.error))
        return
      }
      resolve({ peaks: { bucketMs: data.bucketMs, min: data.peaksMin, max: data.peaksMax }, onsetsMs: data.onsetsMs, durationMs: data.durationMs })
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message))
    }
    worker.postMessage({ mono, sampleRate }, [mono.buffer])
  })
}

const inFlight = new Map<string, Promise<TrackAnalysis | null>>()

/**
 * Waveform peaks and onsets of a variant's track, from the browser cache or computed once: the
 * track is decoded here (decodeAudioData runs off the main thread in the browser), everything
 * else in a worker. `null` when the track isn't available on this device.
 */
export function loadTrackAnalysis(variantId: string, trackId: string): Promise<TrackAnalysis | null> {
  const key = `${variantId}:${trackId}:v${VERSION}`
  const running = inFlight.get(key)
  if (running) return running
  const promise = (async () => {
    const cached = await readCache(key)
    if (cached) return cached
    const blob = await getTrack(variantId, trackId)
    if (!blob) return null
    const ctx = new AudioContext()
    let mono: Float32Array
    let sampleRate: number
    try {
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      mono = mixToMono(buffer)
      sampleRate = buffer.sampleRate
    } finally {
      void ctx.close()
    }
    const analysis = await analyzeInWorker(mono, sampleRate)
    await writeCache(key, analysis)
    return analysis
  })().finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

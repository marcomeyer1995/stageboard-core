import type { EncodeReply, EncodeRequest } from './opusEncodeWorker'
import { TRACK_RATE } from './opusEncode'
import wasmUrl from './stageboard_opus.wasm?url'

/**
 * Any audio file the browser can read (MP3, AAC, WAV, FLAC, WebM, …) → the track format, Ogg Opus
 * (docs/30 §8h). The browser decodes it straight to 48 kHz (an OfflineAudioContext at that rate
 * resamples on decoding), a worker encodes it. Not wired into the upload yet.
 */
export async function encodeForUpload(source: Blob, onProgress?: (done: number) => void): Promise<Blob> {
  const decoded = await new OfflineAudioContext(2, 1, TRACK_RATE).decodeAudioData(await source.arrayBuffer())
  const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, c) => decoded.getChannelData(c).slice())
  const worker = new Worker(new URL('./opusEncodeWorker.ts', import.meta.url), { type: 'module' })
  try {
    const file = await new Promise<Uint8Array>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<EncodeReply>) => {
        if (e.data.type === 'progress') onProgress?.(e.data.done)
        else if (e.data.type === 'done') resolve(e.data.file)
        else reject(new Error(e.data.message))
      }
      worker.onerror = (e) => reject(new Error(e.message))
      const request: EncodeRequest = { wasmUrl: new URL(wasmUrl, location.href).href, channels }
      worker.postMessage(request, channels.map((c) => c.buffer))
    })
    return new Blob([file], { type: 'audio/ogg; codecs=opus' })
  } finally {
    worker.terminate()
  }
}

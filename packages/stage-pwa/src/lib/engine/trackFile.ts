import { webmOpusToOgg } from 'shared-types'

/** Ogg with an OpusHead in its first page - what the engine plays. */
export async function isOggOpus(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 36).arrayBuffer())
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to))
  return head.length >= 36 && text(0, 4) === 'OggS' && text(28, 36) === 'OpusHead'
}

/** The track format's MIME type (docs/30 §8h). */
export const TRACK_MIME = 'audio/ogg; codecs=opus'

/** This device cannot convert (no WebAssembly / Web Audio): nothing is uploaded in another format. */
export class NoEncoderError extends Error {
  constructor() {
    super('no encoder')
  }
}

/** Whether this browser can convert a file to the track format at all. */
export function canEncodeHere(): boolean {
  return typeof WebAssembly !== 'undefined' && typeof OfflineAudioContext !== 'undefined' && typeof Worker !== 'undefined'
}

/**
 * Any uploaded file as the track format, Ogg Opus (#775; docs/30 §8h "Opus only, the uploading
 * device converts"): Ogg Opus as it is, WebM/Opus re-wrapped losslessly, anything else decoded by
 * the browser and encoded with the WASM encoder. `onProgress` 0-1 while encoding.
 */
export async function toTrackFile(file: Blob, onProgress?: (done: number) => void): Promise<Blob> {
  if (await isOggOpus(file)) return file
  const remuxed = webmOpusToOgg(new Uint8Array(await file.arrayBuffer()))
  if (remuxed) return new Blob([remuxed], { type: TRACK_MIME })
  if (!canEncodeHere()) throw new NoEncoderError()
  const { encodeForUpload } = await import('./encodeForUpload')
  return encodeForUpload(file, onProgress)
}

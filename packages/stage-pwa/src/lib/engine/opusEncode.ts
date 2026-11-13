/**
 * The track format, made on the uploading device (docs/30 §8h): Ogg Opus, 48 kHz, 160 kbit/s, by
 * libopus as WebAssembly (native/engine/wasm/build-opus.sh → `stageboard_opus.wasm`, checked in and
 * rebuilt by CI). No DOM here: it runs in opusEncodeWorker.ts and in tests under Node.
 *
 * The file says where its first sample is and how long it is: every device plays it from the same
 * sample, which MP3/AAC can't promise (25-50 ms apart between decoders).
 */

interface Exports {
  memory: WebAssembly.Memory
  _initialize(): void
  sb_alloc(bytes: number): number
  sb_free(ptr: number): void
  sb_enc_start(channels: number, bitrate: number): number
  sb_enc_write(writer: number, pcm: number, frames: number): void
  sb_enc_finish(writer: number): void
  sb_enc_data(writer: number): number
  sb_enc_size(writer: number): number
  sb_enc_clear(writer: number): void
  sb_enc_destroy(writer: number): void
  sb_check(data: number, size: number): number
}

/** The track format's bitrate (docs/30 §8h) - an average: Opus gives hard passages more. */
export const TRACK_BITRATE = 160_000
export const TRACK_RATE = 48_000
/** Frames handed over per call: a second - small enough to report progress often. */
const CHUNK = 48_000

/** Only to print errors (libc's stdio): no file in a worker - "bad file" (WASI errno 8). */
const WASI = { wasi_snapshot_preview1: { fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8 } }

function instantiate(module: WebAssembly.Module): Exports {
  const x = new WebAssembly.Instance(module, WASI).exports as unknown as Exports
  x._initialize()
  return x
}

/**
 * Encodes 48 kHz PCM (one Float32Array per channel, mono or stereo) into an Ogg Opus file and
 * checks it reads back to exactly as many frames - else it throws, nothing broken gets uploaded.
 * `onProgress(done)` from 0 to 1.
 */
export function encodeTrack(module: WebAssembly.Module, channels: readonly Float32Array[], onProgress?: (done: number) => void, bitrate = TRACK_BITRATE): Uint8Array {
  const count = Math.min(2, channels.length)
  if (count < 1) throw new Error('keine Audiodaten')
  const frames = channels[0]!.length
  const x = instantiate(module)
  const writer = x.sb_enc_start(count, bitrate)
  if (!writer) throw new Error('Opus-Encoder nicht verfügbar')
  const pcm = x.sb_alloc(CHUNK * count * 4)
  const pieces: Uint8Array[] = []
  const collect = () => {
    const size = x.sb_enc_size(writer)
    if (size > 0) pieces.push(new Uint8Array(x.memory.buffer, x.sb_enc_data(writer), size).slice())
    x.sb_enc_clear(writer)
  }
  try {
    for (let start = 0; start < frames; start += CHUNK) {
      const n = Math.min(CHUNK, frames - start)
      // A view after any allocation (growing memory detaches older ones), interleaved.
      const into = new Float32Array(x.memory.buffer, pcm, n * count)
      for (let c = 0; c < count; c++) {
        const from = channels[c]!
        for (let i = 0; i < n; i++) into[i * count + c] = from[start + i]!
      }
      x.sb_enc_write(writer, pcm, n)
      collect()
      onProgress?.((start + n) / frames)
    }
    x.sb_enc_finish(writer)
    collect()
  } finally {
    x.sb_free(pcm)
    x.sb_enc_destroy(writer)
  }
  const file = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of pieces) {
    file.set(p, at)
    at += p.length
  }
  const got = checkTrack(module, file)
  if (got !== frames) throw new Error(`Opus-Datei fehlerhaft (${got} statt ${frames} Frames)`)
  return file
}

/** Reads a file as the players will (native OpusClip): its frames, or -1 if it is broken. */
export function checkTrack(module: WebAssembly.Module, file: Uint8Array): number {
  const x = instantiate(module)
  const at = x.sb_alloc(Math.max(1, file.length))
  new Uint8Array(x.memory.buffer, at, file.length).set(file)
  const frames = x.sb_check(at, file.length)
  x.sb_free(at)
  return frames
}

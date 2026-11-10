// Encodes a track off the main thread (opusEncode.ts): a 4-minute song takes seconds of CPU, which
// must not freeze the page. In: { wasmUrl, channels }, out: progress, then the file or an error.
import { encodeTrack } from './opusEncode'

export interface EncodeRequest {
  wasmUrl: string
  channels: Float32Array[]
}

export type EncodeReply = { type: 'progress'; done: number } | { type: 'done'; file: Uint8Array } | { type: 'error'; message: string }

const reply = (m: EncodeReply, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: EncodeReply, t: Transferable[]): void }).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  try {
    const module = await WebAssembly.compile(await (await fetch(e.data.wasmUrl)).arrayBuffer())
    let last = 0
    const file = encodeTrack(module, e.data.channels, (done) => {
      if (done - last >= 0.02 || done === 1) {
        last = done
        reply({ type: 'progress', done })
      }
    })
    reply({ type: 'done', file }, [file.buffer])
  } catch (err) {
    reply({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

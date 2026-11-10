// The engine core in the AudioWorklet (docs/30 §8h stage 2): renders every quantum on the audio
// thread from its own plan - beats, transport and the clock map - so the click no longer depends on
// the page's timers, which a locked screen throttles to once a minute (Fire, 2026-11-10).
// Bundled on its own (engineClick.ts imports it as `?worker&url`).

import { ENGINE_PROCESSOR, type EngineMessage, type EngineProcessorOptions, type EngineStatus } from './engineMessages'
import { WasmEngine } from './wasmEngine'

// The AudioWorkletGlobalScope - not in TypeScript's DOM library.
declare const sampleRate: number
declare const currentFrame: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: { processorOptions?: unknown })
}
declare function registerProcessor(name: string, processor: new (options: { processorOptions: EngineProcessorOptions }) => AudioWorkletProcessor): void

class EngineProcessor extends AudioWorkletProcessor {
  private readonly engine: WasmEngine

  constructor(options: { processorOptions: EngineProcessorOptions }) {
    super(options)
    this.engine = new WasmEngine(options.processorOptions.module, sampleRate, 2)
    this.port.onmessage = (e: MessageEvent<EngineMessage>) => this.apply(e.data)
  }

  private apply(m: EngineMessage): void {
    const e = this.engine
    switch (m.type) {
      case 'transport':
        e.setTransport(m.transport)
        break
      case 'beats':
        e.setBeatArrays(m.songMs, m.accent)
        break
      case 'gain':
        e.setGain(m.bus, m.gain)
        break
      case 'master':
        e.setMasterGain(m.gain)
        break
      case 'clock':
        e.observeClock(m.frame, m.bandMs)
        break
      case 'status': {
        const status: EngineStatus = { type: 'status', frame: currentFrame, clockJumps: e.clockJumps(), clockDriftPpm: e.clockDriftPpm() }
        this.port.postMessage(status)
        break
      }
    }
    // Here, not in process(): what a message replaced is freed outside a render.
    e.collect()
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (out && out[0]) this.engine.render(out[0], out[1] ?? null, currentFrame)
    return true
  }
}

registerProcessor(ENGINE_PROCESSOR, EngineProcessor)

import type { TransportState } from '../playbackTransport'
import type { EngineBus } from './wasmEngine'

/** What the page tells the engine's worklet (engineProcessor.ts). Applied between two renders. */
export type EngineMessage =
  | { type: 'transport'; transport: TransportState }
  | { type: 'beats'; songMs: Float64Array; accent: Uint8Array }
  | { type: 'gain'; bus: EngineBus; gain: number }
  | { type: 'master'; gain: number }
  /** Output frame `frame` is heard at band time `bandMs`. */
  | { type: 'clock'; frame: number; bandMs: number }
  | { type: 'status' }

/** The worklet's answer to `status` - self-monitoring (docs/30 §8i). */
export interface EngineStatus {
  type: 'status'
  frame: number
  clockJumps: number
  clockDriftPpm: number
}

/** Fixed per node: the compiled module (compiled once on the page, cloned into the worklet). */
export interface EngineProcessorOptions {
  module: WebAssembly.Module
}

export const ENGINE_PROCESSOR = 'sb-engine'

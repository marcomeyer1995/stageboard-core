import type { TransportState } from '../playbackTransport'

/**
 * The audio engine's C++ core as WebAssembly (docs/30 §8h stage 2, native/engine/wasm): the same
 * code as the native build, so browser, WebView and Android plan and click alike. This wrapper
 * has no DOM dependency - it runs in the AudioWorklet (engineProcessor.ts) and in tests under Node.
 *
 * `stageboard_engine.wasm` next to this file is built by native/engine/wasm/build.sh and checked
 * in, so the app builds without the WebAssembly toolchain; CI rebuilds it and fails if it differs.
 */

interface Exports {
  memory: WebAssembly.Memory
  _initialize(): void
  sb_alloc(bytes: number): number
  sb_free(ptr: number): void
  sb_create(sampleRate: number, channels: number): number
  sb_destroy(engine: number): void
  sb_set_transport(engine: number, status: number, startedAt: number, accumulatedMs: number, rate: number, hasJump: number, jumpAt: number, jumpToMs: number, jumpRate: number): number
  sb_set_beats(engine: number, songMs: number, accent: number, count: number): number
  sb_set_gain(engine: number, bus: number, gain: number): number
  sb_set_master_gain(engine: number, gain: number): number
  sb_observe_clock(engine: number, frame: number, bandMs: number): number
  sb_collect(engine: number): void
  sb_render(engine: number, left: number, right: number, frames: number, firstFrame: number): void
  sb_clock_jumps(engine: number): number
  sb_clock_drift_ppm(engine: number): number
}

/** One beat of the click: song ms, and whether it is the bar's first (louder, higher). */
export interface EngineBeat {
  songMs: number
  accent: boolean
}

/** Where a source is mixed (engine.h `Bus`). */
export const ENGINE_BUS = { click: 0, track: 1, stem: 2, announce: 3 } as const
export type EngineBus = keyof typeof ENGINE_BUS

/** The render quantum: Web Audio always asks for 128 frames. */
export const QUANTUM = 128

/** The core asks the system for nothing but these three, and only to print errors (libc's stdio) -
 * there is no file in the audio thread, so each answers "bad file" (WASI errno 8). */
const WASI = { wasi_snapshot_preview1: { fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8 } }

const STATUS = { stopped: 0, playing: 1, paused: 2 } as const

export class WasmEngine {
  private readonly x: Exports
  private readonly engine: number
  private readonly left: number
  private readonly right: number

  /** Synchronous: in a worklet (or Node) a module of any size may be instantiated at once. */
  constructor(module: WebAssembly.Module, sampleRate: number, readonly channels: 1 | 2) {
    const instance = new WebAssembly.Instance(module, WASI)
    this.x = instance.exports as unknown as Exports
    this.x._initialize()
    this.engine = this.x.sb_create(sampleRate, channels)
    this.left = this.x.sb_alloc(QUANTUM * 4)
    this.right = this.x.sb_alloc(QUANTUM * 4)
  }

  /** The band's transport (playbackTransport.ts). Song time follows it; the engine never decides. */
  setTransport(t: TransportState): boolean {
    const jump = t.jump ?? null
    const rate = t.rate ?? 1
    // Playing without a start time stands still, as in computeActiveMs.
    const status = t.status === 'playing' && t.startedAt === null ? STATUS.paused : STATUS[t.status]
    return this.x.sb_set_transport(this.engine, status, t.startedAt ?? 0, t.accumulatedMs, rate, jump ? 1 : 0, jump?.at ?? 0, jump?.toMs ?? 0, jump?.rate ?? rate) === 1
  }

  /** The song's beats, sorted by time - replaces the previous ones whole. */
  setBeats(beats: readonly EngineBeat[]): boolean {
    return this.setBeatArrays(Float64Array.from(beats, (b) => b.songMs), Uint8Array.from(beats, (b) => (b.accent ? 1 : 0)))
  }

  /** The same as typed arrays (what the worklet gets posted): song ms, and 1 for a downbeat. */
  setBeatArrays(songMs: Float64Array, accent: Uint8Array): boolean {
    const n = Math.min(songMs.length, accent.length)
    const times = this.x.sb_alloc(Math.max(1, n) * 8)
    const accents = this.x.sb_alloc(Math.max(1, n))
    // Views after the allocations: growing memory detaches older ones.
    new Float64Array(this.x.memory.buffer, times, n).set(songMs.subarray(0, n))
    new Uint8Array(this.x.memory.buffer, accents, n).set(accent.subarray(0, n))
    const ok = this.x.sb_set_beats(this.engine, times, accents, n) === 1
    this.x.sb_free(times)
    this.x.sb_free(accents)
    return ok
  }

  setGain(bus: EngineBus, gain: number): boolean {
    return this.x.sb_set_gain(this.engine, ENGINE_BUS[bus], gain) === 1
  }

  setMasterGain(gain: number): boolean {
    return this.x.sb_set_master_gain(this.engine, gain) === 1
  }

  /** Output frame `frame` is heard at band time `bandMs` (output timestamp + clock sync). */
  observeClock(frame: number, bandMs: number): boolean {
    return this.x.sb_observe_clock(this.engine, frame, bandMs) === 1
  }

  /** Frees what the engine replaced - call between renders, never inside one. */
  collect(): void {
    this.x.sb_collect(this.engine)
  }

  /** Fills `left` (and `right`, stereo) - up to QUANTUM frames, the first being output frame `firstFrame`. */
  render(left: Float32Array, right: Float32Array | null, firstFrame: number): void {
    const frames = Math.min(QUANTUM, left.length)
    this.x.sb_render(this.engine, this.left, this.right, frames, firstFrame)
    const buffer = this.x.memory.buffer
    left.set(new Float32Array(buffer, this.left, frames))
    if (right && this.channels === 2) right.set(new Float32Array(buffer, this.right, frames))
  }

  /** Self-monitoring (docs/30 §8i): how often the clock had to jump, and the drift it learned. */
  clockJumps(): number {
    return this.x.sb_clock_jumps(this.engine)
  }

  clockDriftPpm(): number {
    return this.x.sb_clock_drift_ppm(this.engine)
  }

  destroy(): void {
    this.x.sb_free(this.left)
    this.x.sb_free(this.right)
    this.x.sb_destroy(this.engine)
  }
}

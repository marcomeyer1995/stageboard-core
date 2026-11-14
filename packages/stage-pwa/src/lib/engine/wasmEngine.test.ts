import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TransportState } from '../playbackTransport'
import { QUANTUM, WasmEngine, type EngineBeat } from './wasmEngine'

// The checked-in module, rendered exactly as the AudioWorklet will: 128 frames at a time. The
// expected frames are the native tests' (native/engine/tests) - the same core must give the same.

const module = new WebAssembly.Module(readFileSync(join(__dirname, 'stageboard_engine.wasm')))
const RATE = 48000

function beatsEvery(ms: number, count: number, perBar: number): EngineBeat[] {
  return Array.from({ length: count }, (_, i) => ({ songMs: i * ms, accent: i % perBar === 0 }))
}

function playingFrom(startedAt: number, extra: Partial<TransportState> = {}): TransportState {
  return { status: 'playing', startedAt, accumulatedMs: 0, ...extra }
}

/** Renders `seconds` in quanta, frame 0 first; optional hook before each quantum. */
function renderAll(engine: WasmEngine, seconds: number, before?: (frame: number) => void): { left: Float32Array; right: Float32Array } {
  const frames = Math.round(seconds * RATE)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let f = 0; f < frames; f += QUANTUM) {
    before?.(f)
    const n = Math.min(QUANTUM, frames - f)
    engine.render(left.subarray(f, f + n), right.subarray(f, f + n), f)
  }
  return { left, right }
}

/** First frame of each click: sound after at least 10 ms of silence. */
function onsets(s: Float32Array): number[] {
  const found: number[] = []
  let quiet = Infinity
  for (let i = 0; i < s.length; i++) {
    if (Math.abs(s[i]!) > 1e-6) {
      if (quiet >= 480) found.push(i)
      quiet = 0
    } else {
      quiet++
    }
  }
  return found
}

function peak(s: Float32Array, from: number, length: number): number {
  let p = 0
  for (let i = from; i < from + length; i++) p = Math.max(p, Math.abs(s[i]!))
  return p
}

describe('WasmEngine', () => {
  it('clicks on the exact frame, downbeat louder', () => {
    const engine = new WasmEngine(module, RATE, 2)
    engine.observeClock(0, 10000) // frame 0 is heard at band time 10 s
    engine.setTransport(playingFrom(10000))
    engine.setBeats(beatsEvery(500, 4, 4))
    const { left, right } = renderAll(engine, 2.2)
    const found = onsets(left)
    expect(found).toHaveLength(4)
    found.forEach((f, i) => expect(Math.abs(f - i * 24000)).toBeLessThanOrEqual(1))
    expect(peak(left, 0, 1440)).toBeCloseTo(0.5, 1)
    expect(peak(left, 24000, 1440)).toBeCloseTo(0.35, 1)
    expect(right).toEqual(left) // the click is in the middle
    engine.destroy()
  })

  it('follows a section jump and a pause', () => {
    // At band 1250 the song jumps from 1250 to 4000: beats 0, 500, 1000, then 4000, 4500.
    const jumping = new WasmEngine(module, RATE, 1)
    jumping.observeClock(0, 0)
    jumping.setTransport(playingFrom(0, { jump: { at: 1250, toMs: 4000 } }))
    jumping.setBeats(beatsEvery(500, 12, 4))
    const found = onsets(renderAll(jumping, 2).left)
    expect(found).toHaveLength(5)
    ;[0, 24000, 48000, 60000, 84000].forEach((f, i) => expect(Math.abs(found[i]! - f)).toBeLessThanOrEqual(1))

    const pausing = new WasmEngine(module, RATE, 1)
    pausing.observeClock(0, 0)
    pausing.setTransport(playingFrom(0))
    pausing.setBeats(beatsEvery(500, 8, 4))
    const out = renderAll(pausing, 3, (frame) => {
      if (frame === 48000) pausing.setTransport({ status: 'paused', startedAt: null, accumulatedMs: 1000 })
    })
    expect(onsets(out.left)).toHaveLength(2)
  })

  it('stays silent while "playing" without a start time, as computeActiveMs does', () => {
    const engine = new WasmEngine(module, RATE, 1)
    engine.observeClock(0, 0)
    engine.setTransport({ status: 'playing', startedAt: null, accumulatedMs: 0 })
    engine.setBeats(beatsEvery(500, 4, 4))
    expect(onsets(renderAll(engine, 1).left)).toHaveLength(0)
  })

  it("learns the device's drift without jumping", () => {
    // Fire: its frames come 256 ppm too fast; the clock is observed once a second.
    const engine = new WasmEngine(module, RATE, 1)
    const ppm = 256
    renderAll(engine, 120, (frame) => {
      if (frame % RATE < QUANTUM) engine.observeClock(frame, (frame * 1000) / RATE / (1 + ppm * 1e-6))
    })
    expect(engine.clockJumps()).toBe(0)
    expect(Math.abs(engine.clockDriftPpm() + ppm)).toBeLessThan(15)
  })

  it('frees replaced beat plans - memory stays the same', () => {
    const engine = new WasmEngine(module, RATE, 1)
    engine.observeClock(0, 0)
    engine.setTransport(playingFrom(0))
    const out = new Float32Array(QUANTUM)
    const cycle = (n: number) => {
      for (let i = 0; i < n; i++) {
        engine.setBeats(beatsEvery(500, 2000, 4))
        engine.render(out, null, i * QUANTUM)
        engine.collect()
      }
    }
    cycle(50)
    const before = (engine as unknown as { x: { memory: WebAssembly.Memory } }).x.memory.buffer.byteLength
    cycle(2000)
    expect((engine as unknown as { x: { memory: WebAssembly.Memory } }).x.memory.buffer.byteLength).toBe(before)
  })
})

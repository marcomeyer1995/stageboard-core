import { describe, expect, it } from 'vitest'
import { __nativeOutputWorkerForTests } from './nativeOutput'

const RATE = 48000
const CHUNK = 1920 // 40 ms

/** Runs the worker's source with a fake clock; returns a function feeding one chunk and the lines it posted. */
function worker() {
  let now = 1_000_000
  const lines: { at: number; line: number }[] = []
  const port: { onmessage: ((ev: { data: { first: number; pcm: Int16Array } }) => void) | null } = { onmessage: null }
  const run = new Function(
    'postMessage',
    'WebSocket',
    'Date',
    'close',
    `let onmessage; ${__nativeOutputWorkerForTests.source}; return (m) => onmessage({ data: m })`,
  ) as (post: (m: { type: string; at: number; line: number }) => void, ws: unknown, date: unknown, close: () => void) => (m: unknown) => void
  const send = run(
    (m) => {
      if (m.type === 'line') lines.push({ at: m.at, line: m.line })
    },
    class {
      readyState = 0
    },
    { now: () => now },
    () => {},
  )
  send({ type: 'init', rate: RATE, url: 'ws://x', port, constants: __nativeOutputWorkerForTests.constants })
  const pcm = new Int16Array(CHUNK * 2)
  return {
    /** A chunk of frames [first, first + CHUNK) arriving at `at`. */
    chunk(first: number, at: number) {
      now = at
      port.onmessage!({ data: { first, pcm } })
    },
    lines,
  }
}

describe('native output worker: the render line', () => {
  it('follows a lasting shift of the WebView clock within ~2 s - a rotation stopped it 0.5 s (Redmi, 2026-11-06)', () => {
    const w = worker()
    const t0 = 1_000_000
    let first = 0
    // 90 s rendered on time (arriving 10-50 ms after), then the clock stops 530 ms for good.
    for (; first < RATE * 120; first += CHUNK) {
      const shift = first >= RATE * 90 ? 530 : 0
      w.chunk(first, t0 + ((first + CHUNK) * 1000) / RATE + shift + 10 + ((first / CHUNK) % 5) * 10)
    }
    const at = (ms: number) => w.lines.filter((l) => l.at <= t0 + ms).pop()!.line - t0
    expect(at(89_000)).toBeCloseTo(10, -1)
    // Before: stuck at the old edge for a minute, every frame 520 ms "late".
    expect(at(93_000)).toBeGreaterThan(500)
    expect(at(119_000)).toBeCloseTo(540, -1)
  })

  it('does not jump for arrivals that are only sometimes late (the Fire renders in blocks of up to 180 ms)', () => {
    const w = worker()
    const t0 = 1_000_000
    for (let first = 0; first < RATE * 120; first += CHUNK) {
      // Every fourth chunk on time, the others 120-180 ms behind.
      const late = (first / CHUNK) % 4 === 0 ? 0 : 120 + ((first / CHUNK) % 3) * 30
      w.chunk(first, t0 + ((first + CHUNK) * 1000) / RATE + 5 + late)
    }
    const lines = w.lines.filter((l) => l.at > t0 + 70_000).map((l) => l.line - t0)
    expect(Math.max(...lines)).toBeLessThan(20)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { clickTimeline } from '../beatGrid'
import type { ClickEngineState } from '../clickEngine'

vi.mock('./engineProcessor.ts?worker&url', () => ({ default: 'processor.js' }))
vi.mock('./stageboard_engine.wasm?url', () => ({ default: 'engine.wasm' }))
const calls: [string, unknown[]][] = []
vi.mock('../nativeOutput', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push([name, args])
  return {
    nativeEngine: { enable: record('enable'), transport: record('transport'), beats: record('beats'), offset: record('offset'), gain: record('gain'), feeds: record('feeds') },
    useNativeOutputStore: { getState: () => ({ delayMs: 410 }) },
  }
})
vi.mock('../clockSync', () => ({ getServerTime: () => Date.now() + 2126 }))

const { useOutputPlanStore, PLAIN_PLAN } = await import('../audioMix')
const { __resetNativeEngineSessionForTests, acquireNativeEngine, releaseNativeEngine } = await import('./nativeEngineSession')
const { bandOffsetMs, nativeTransport, startNativeEngineClick, stopNativeEngineClick } = await import('./nativeEngineClick')

const state = (over: Partial<ClickEngineState> = {}): ClickEngineState => ({
  elapsedMs: 0,
  timeline: clickTimeline({ bpm: 120, timeSignature: '4/4' }),
  transport: { status: 'playing', startedAt: 5000, accumulatedMs: 0 },
  outputLatencyMs: 425, // the pipe's 410 ms + 15 ms the Fire's speaker adds (latencyProfiles.ts)
  ...over,
})

afterEach(() => {
  stopNativeEngineClick()
  releaseNativeEngine('track')
  __resetNativeEngineSessionForTests()
  calls.length = 0
  useOutputPlanStore.setState({ plan: PLAIN_PLAN })
})

describe('nativeEngineClick', () => {
  it('band offset: server offset plus only the trim - the callback has no pipe delay', () => {
    expect(bandOffsetMs(102_126, 100_000, 425, 410)).toBe(2126 + 15)
  })

  it('translates the transport, a jump with its own speed included', () => {
    expect(nativeTransport({ status: 'playing', startedAt: 100, accumulatedMs: -2000, rate: 0.8, jump: { at: 900, toMs: 40_000, rate: 1 } })).toEqual({
      status: 1,
      startedAt: 100,
      accumulatedMs: -2000,
      rate: 0.8,
      hasJump: true,
      jumpAt: 900,
      jumpToMs: 40_000,
      jumpRate: 1,
    })
    // "Playing" without a start time stands still.
    expect(nativeTransport({ status: 'playing', startedAt: null, accumulatedMs: 0 }).status).toBe(2)
  })

  it('on start: offset, level, place, enable, then transport and the whole plan', () => {
    startNativeEngineClick(() => state())
    expect(calls.map(([name]) => name)).toEqual(['offset', 'gain', 'feeds', 'enable', 'transport', 'beats'])
    const offset = calls[0]![1][0] as number
    expect(offset).toBeGreaterThan(2126 + 15 - 5)
    expect(offset).toBeLessThan(2126 + 15 + 5)
    expect(calls[2]![1]).toEqual([0, 0, 1]) // the click bus, left on left, right on right
    expect(calls[3]![1]).toEqual([true])
    const songMs = calls[5]![1][0] as Float64Array
    expect(Array.from(songMs.slice(0, 3))).toEqual([0, 500, 1000])
  })

  it("Solo Üben: the offset is on the device's own clock, not the server's (the click came 650 ms early on the Redmi)", () => {
    startNativeEngineClick(() => state({ transportNow: Date.now }))
    const offset = calls[0]![1][0] as number
    expect(offset).toBeGreaterThan(15 - 5)
    expect(offset).toBeLessThan(15 + 5)
  })

  it('puts the click where the output plan has it (the map, #742): left only for in-ear, silent where the plan says so', () => {
    useOutputPlanStore.setState({ plan: { ...PLAIN_PLAN, click: { left: 'mix', right: null } } })
    startNativeEngineClick(() => state())
    expect(calls.find(([name]) => name === 'feeds')![1]).toEqual([0, 2, 3])
    stopNativeEngineClick()
    calls.length = 0
    useOutputPlanStore.setState({ plan: { ...PLAIN_PLAN, click: null } })
    startNativeEngineClick(() => state())
    expect(calls.find(([name]) => name === 'feeds')![1]).toEqual([0, 3, 3])
  })

  it('on stop: no more beats, stopped transport, then disabled', () => {
    startNativeEngineClick(() => state())
    calls.length = 0
    stopNativeEngineClick()
    expect(calls.map(([name]) => name)).toEqual(['beats', 'transport', 'enable'])
    expect((calls[0]![1][0] as Float64Array).length).toBe(0)
    expect((calls[1]![1][0] as { status: number }).status).toBe(0)
    expect(calls[2]![1]).toEqual([false])
  })

  it('"Klick aus" while the track plays in the engine: only the beats go, the engine keeps running', () => {
    acquireNativeEngine('track')
    startNativeEngineClick(() => state())
    calls.length = 0
    stopNativeEngineClick()
    expect(calls.map(([name]) => name)).toEqual(['beats'])
  })
})

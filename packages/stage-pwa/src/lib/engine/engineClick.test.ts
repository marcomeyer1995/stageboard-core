import { describe, expect, it, vi } from 'vitest'
import { clickTimeline } from '../beatGrid'
import type { ClickEngineState } from '../clickEngine'
import type { TransportState } from '../playbackTransport'
import type { EngineMessage } from './engineMessages'

vi.mock('./engineProcessor.ts?worker&url', () => ({ default: 'processor.js' }))
vi.mock('./stageboard_engine.wasm?url', () => ({ default: 'engine.wasm' }))
vi.mock('../audioClock', () => ({ sharedAudioClock: { now: () => 2 } }))
vi.mock('../clockSync', () => ({ getServerTime: () => 100_650 }))

const { HORIZON_MS, audibleBeats, clockPair, createFollower, nudgedBeats, planBeats } = await import('./engineClick')

const at120 = clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 1 })
const playing: TransportState = { status: 'playing', startedAt: 1000, accumulatedMs: -2000 }

describe('planBeats', () => {
  it('plans the count-in before bar 1 and every beat up to the horizon, downbeats marked', () => {
    const p = planBeats(at120)
    expect(Array.from(p.songMs.slice(0, 6))).toEqual([-2000, -1500, -1000, -500, 0, 500])
    expect(Array.from(p.accent.slice(0, 6))).toEqual([1, 0, 0, 0, 1, 0])
    expect(Array.from(p.beat.slice(0, 2))).toEqual([-4, -3])
    expect(p.songMs[p.songMs.length - 1]).toBeLessThan(HORIZON_MS)
    expect(p.songMs.length).toBe(4 + HORIZON_MS / 500)
  })

  it('leaves out the beats a "Klick aus" cue silences - the others keep their place', () => {
    const { songMs } = audibleBeats(planBeats(at120), (ms) => ms < 1000 || ms >= 2000)
    expect(Array.from(songMs.slice(4, 8))).toEqual([0, 500, 2000, 2500])
  })
})

describe('nudgedBeats', () => {
  it('keeps the beats up to now and the next one, then runs on at the new tempo', () => {
    const before = planBeats(clickTimeline({ bpm: 120, timeSignature: '4/4' }))
    const after = nudgedBeats(before, clickTimeline({ bpm: 100, timeSignature: '4/4' }), 1200)
    // Played: 0, 500, 1000; next was 1500 - it stays, then 600 ms apart (100 BPM).
    expect(Array.from(after.songMs.slice(0, 6))).toEqual([0, 500, 1000, 1500, 2100, 2700])
    // Bar 2's downbeat (beat 4) stays the downbeat.
    expect(after.beat[4]).toBe(4)
    expect(after.accent[4]).toBe(1)
  })
})

describe('createFollower', () => {
  const state = (over: Partial<ClickEngineState> = {}): ClickEngineState => ({ elapsedMs: 0, timeline: at120, transport: playing, ...over })

  it('sends transport and beats once, then only what changed', () => {
    const sent: EngineMessage[] = []
    const f = createFollower((m) => sent.push(m))
    f.update(state())
    expect(sent.map((m) => m.type)).toEqual(['transport', 'beats'])
    f.update(state({ elapsedMs: 50 }))
    f.update(state({ elapsedMs: 100 }))
    expect(sent).toHaveLength(2) // song time moving on is the engine's job
    f.update(state({ transport: { ...playing, jump: { at: 5000, toMs: 20000 } } }))
    expect(sent.map((m) => m.type)).toEqual(['transport', 'beats', 'transport'])
  })

  it('stops the engine when nothing plays', () => {
    const sent: EngineMessage[] = []
    const f = createFollower((m) => sent.push(m))
    f.update(state())
    f.update(state({ elapsedMs: null }))
    const last = sent[sent.length - 1]!
    expect(last.type === 'transport' && last.transport.status).toBe('stopped')
  })

  it('continues a nudged tempo from the next beat, but places a new grid whole', () => {
    const sent: EngineMessage[] = []
    const f = createFollower((m) => sent.push(m))
    const t120 = clickTimeline({ bpm: 120, timeSignature: '4/4' })
    f.update(state({ timeline: t120, elapsedMs: 1200 }))
    f.update(state({ timeline: clickTimeline({ bpm: 100, timeSignature: '4/4' }), elapsedMs: 1250 }))
    const nudged = sent[sent.length - 1]!
    expect(nudged.type === 'beats' && Array.from(nudged.songMs.slice(3, 5))).toEqual([1500, 2100])
    const grid = clickTimeline({ bpm: 100, timeSignature: '4/4', beatGrid: { points: [{ id: 'a', bar: 1, timeMs: 100 }, { id: 'b', bar: 9, timeMs: 19300 }], meters: [] } })
    f.update(state({ timeline: grid, elapsedMs: 1300 }))
    const placed = sent[sent.length - 1]!
    expect(placed.type === 'beats' && placed.songMs[0]).toBe(100)
  })
})

describe('clockPair', () => {
  const ctx = { sampleRate: 48000 } as AudioContext
  it("is on the transport's clock: the server's by default, the device's in Solo Üben (650 ms apart on the Redmi)", () => {
    expect(clockPair(ctx, 20)).toEqual({ type: 'clock', frame: 96000, bandMs: 100_670 })
    expect(clockPair(ctx, 20, () => 100_000)).toEqual({ type: 'clock', frame: 96000, bandMs: 100_020 })
  })
})

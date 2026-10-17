import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import type { CueTransport } from './cueSchedule'
import { MidiClockEngine, type ClockOutput } from './midiClockEngine'

const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' }) // tick 20.83 ms, 16th 125 ms
const stopped: CueTransport = {
  status: 'stopped',
  startedAt: null,
  accumulatedMs: 0,
}

function rig(latencyMs = 0) {
  let now = 100_000
  const sent: { data: number[]; at: number }[] = []
  const output: ClockOutput = {
    send: (data, at) => sent.push({ data, at }),
    latencyMs,
  }
  // perf time == server time here, so timestamps read as server times.
  const engine = new MidiClockEngine(
    () => now,
    () => now,
  )
  return {
    engine,
    sent,
    out: [output],
    advance: (ms: number, input: Parameters<MidiClockEngine['tick']>[0]) => {
      for (let t = 0; t < ms; t += 25) {
        now += 25
        engine.tick(input, [output])
      }
    },
    get now() {
      return now
    },
  }
}
const kind = (data: number[]) =>
  ({
    0xf8: 'clock',
    0xfa: 'start',
    0xfb: 'continue',
    0xfc: 'stop',
    0xf2: 'spp',
  })[data[0]!] ?? 'other'
const events = (sent: { data: number[] }[]) => sent.map((s) => kind(s.data)).filter((k) => k !== 'clock')

describe('MIDI clock engine (#478)', () => {
  it('runs between songs at the song tempo, without Start/Stop', () => {
    const r = rig()
    r.advance(1000, { timeline, transport: stopped, takeKey: null })
    const clocks = r.sent.filter((s) => kind(s.data) === 'clock')
    expect(events(r.sent)).toEqual([])
    expect(clocks[1]!.at - clocks[0]!.at).toBeCloseTo(500 / 24, 6)
  })

  it('a fresh take: Start right before the tick on bar 1, after the Play lead', () => {
    const r = rig()
    r.advance(200, { timeline, transport: stopped, takeKey: null })
    const playAt = r.now
    const playing: CueTransport = {
      status: 'playing',
      startedAt: playAt,
      accumulatedMs: -400,
    } // bar 1 at playAt + 400
    r.advance(1000, { timeline, transport: playing, takeKey: playAt })
    const start = r.sent.find((s) => kind(s.data) === 'start')!
    const clockAfter = r.sent[r.sent.indexOf(start) + 1]!
    expect(events(r.sent)).toEqual(['start'])
    expect(kind(clockAfter.data)).toBe('clock')
    expect(clockAfter.at).toBeCloseTo(playAt + 400, 6)
    expect(start.at).toBeLessThan(clockAfter.at)
  })

  it('runs through the count-in and starts on the downbeat after it', () => {
    const r = rig()
    const playAt = r.now
    const playing: CueTransport = {
      status: 'playing',
      startedAt: playAt,
      accumulatedMs: -2400,
    } // 1 bar count-in + lead
    r.advance(3000, {
      timeline: clickTimeline({
        bpm: 120,
        timeSignature: '4/4',
        countInBars: 1,
      }),
      transport: playing,
      takeKey: playAt,
    })
    const start = r.sent.find((s) => kind(s.data) === 'start')!
    const before = r.sent.filter((s) => kind(s.data) === 'clock' && s.at < start.at)
    expect(before.length).toBeGreaterThan(96) // the whole count-in bar ticked
    expect(r.sent[r.sent.indexOf(start) + 1]!.at).toBeCloseTo(playAt + 2400, 6)
  })

  it('Pause sends Stop; resume sends Song Position Pointer + Continue on the next 16th', () => {
    const r = rig()
    const playAt = r.now
    r.advance(2000, {
      timeline,
      transport: { status: 'playing', startedAt: playAt, accumulatedMs: -400 },
      takeKey: playAt,
    })
    const pausedAt = 1600 // song ms
    r.advance(500, {
      timeline,
      transport: { status: 'paused', startedAt: null, accumulatedMs: pausedAt },
      takeKey: playAt,
    })
    const resumeAt = r.now
    r.advance(500, {
      timeline,
      transport: {
        status: 'playing',
        startedAt: resumeAt,
        accumulatedMs: pausedAt,
      },
      takeKey: playAt,
    })
    expect(events(r.sent)).toEqual(['start', 'stop', 'spp', 'continue'])
    const spp = r.sent.find((s) => kind(s.data) === 'spp')!
    const cont = r.sent.find((s) => kind(s.data) === 'continue')!
    const nextClock = r.sent[r.sent.indexOf(cont) + 1]!
    const sixteenths = spp.data[1]! + (spp.data[2]! << 7)
    // The tick after Continue lies exactly on that 16th of the song.
    expect(nextClock.at - resumeAt + pausedAt).toBeCloseTo(sixteenths * 125, 6)
    expect(spp.at).toBeLessThan(cont.at)
  })

  it('sends everything its output latency early', () => {
    const plain = rig(0)
    const early = rig(40)
    plain.advance(300, { timeline, transport: stopped, takeKey: null })
    early.advance(300, { timeline, transport: stopped, takeKey: null })
    expect(early.sent[0]!.at).toBeCloseTo(plain.sent[0]!.at - 40, 6)
  })

  it('stop() tells running gear to stop', () => {
    const r = rig()
    const playAt = r.now
    r.advance(1000, {
      timeline,
      transport: { status: 'playing', startedAt: playAt, accumulatedMs: -400 },
      takeKey: playAt,
    })
    r.engine.stop(r.out)
    expect(events(r.sent).slice(-1)[0]).toBe('stop')
  })
})

describe('MIDI clock across a section jump (#479)', () => {
  it('ticks on evenly without Stop; Song Position at the boundary; the later fold changes nothing', () => {
    const r = rig()
    const playAt = r.now
    const playing = { status: 'playing' as const, startedAt: playAt, accumulatedMs: -400 }
    r.advance(1_000, { timeline, transport: playing, takeKey: playAt })
    // At song 4 s (bar 3) back to song 0 (bar 1) - announced well ahead.
    const jump = { at: playAt + 4_400, toMs: 0 }
    r.advance(3_200, { timeline, transport: playing, takeKey: playAt, jump })
    // The master folds it a little after the boundary.
    r.advance(2_000, { timeline, transport: { status: 'playing', startedAt: jump.at, accumulatedMs: 0 }, takeKey: playAt })
    expect(events(r.sent)).toEqual(['start', 'spp'])
    const spp = r.sent.find((s) => kind(s.data) === 'spp')!
    expect(spp.data[1]! + (spp.data[2]! << 7)).toBe(0)
    expect(spp.at).toBeCloseTo(jump.at - 0.5, 3) // right before the boundary's tick
    // Every clock exactly one tick apart across the boundary and the fold.
    const clocks = r.sent.filter((s) => kind(s.data) === 'clock').map((s) => s.at).filter((at) => at >= playAt)
    for (let i = 1; i < clocks.length; i++) expect(clocks[i]! - clocks[i - 1]!).toBeCloseTo(500 / 24, 3)
  })
})

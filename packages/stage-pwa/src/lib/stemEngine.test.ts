import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTrack } from './songVariantsDb'
import { openTrackStream, type TrackStream } from './trackStream'
import { __resetStemsForTests, __stemStatsForTests, loadStems, setStemGains, syncStems } from './stemEngine'

vi.mock('./songVariantsDb', () => ({ getTrack: vi.fn() }))
vi.mock('./trackStream', () => ({ openTrackStream: vi.fn() }))
vi.mock('./audioMix', () => ({ sourceOutput: () => ({}) }))

const SR = 48000
const PIECE_S = 0.1
const DURATION_S = 180

interface FakeBuffer {
  id: string
  duration: number
  length: number
  sampleRate: number
  numberOfChannels: number
  getChannelData: () => Float32Array
  copyToChannel: () => void
}
function fakeBuffer(id: string, seconds: number): FakeBuffer {
  const length = Math.round(seconds * SR)
  return {
    id,
    duration: length / SR,
    length,
    sampleRate: SR,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(length),
    copyToChannel: () => {},
  }
}

/** The wall clock; the fake audio clock runs with it. */
let wallMs = 0
interface FakeNode {
  buffer: FakeBuffer | null
  when: number
  offset: number
  stoppedAt: number | null
  rate: number
  out?: unknown
}
const nodes: FakeNode[] = []
const gains: {
  gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }
  connect: ReturnType<typeof vi.fn>
}[] = []
const ctx = {
  state: 'running',
  get currentTime() {
    return wallMs / 1000 + 100
  },
  destination: {},
  resume: vi.fn(async () => {}),
  decodeAudioData: vi.fn(async (data: ArrayBuffer) => fakeBuffer(`full:${new TextDecoder().decode(data)}`, DURATION_S)),
  createBuffer: (_channels: number, length: number) => fakeBuffer('joined', length / SR),
  createGain: () => {
    const gain = {
      gain: { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), setValueCurveAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    gains.push(gain)
    return gain
  },
  createBufferSource: () => {
    const node: FakeNode = {
      buffer: null,
      when: NaN,
      offset: NaN,
      stoppedAt: null,
      rate: 1,
    }
    nodes.push(node)
    return {
      set buffer(b: FakeBuffer) {
        node.buffer = b
      },
      connect: (out: unknown) => {
        node.out = out
      },
      onended: null,
      start: (when: number, offset: number) => {
        node.when = when
        node.offset = offset
      },
      stop: (at: number) => {
        node.stoppedAt = at
      },
      playbackRate: {
        set value(v: number) {
          node.rate = v
        },
        setValueAtTime: (v: number) => {
          node.rate = v
        },
      },
    }
  },
}
vi.mock('./sharedAudioContext', () => ({ getSharedAudioContext: () => ctx }))

/** Streams by track id; `decoded` counts the pieces each has decoded. */
const decoded = new Map<string, number>()
function fakeStream(id: string): TrackStream {
  return {
    durationS: DURATION_S,
    async *buffers(startS: number) {
      for (let i = Math.floor(startS / PIECE_S + 1e-9); i * PIECE_S < DURATION_S - 1e-9; i++) {
        decoded.set(id, (decoded.get(id) ?? 0) + 1)
        yield {
          buffer: fakeBuffer(id, PIECE_S) as unknown as AudioBuffer,
          timestamp: i * PIECE_S,
        }
      }
    },
    dispose: vi.fn(),
  }
}

/** Lets pending promises and due timers run (timers are fake and follow `wallMs`). */
const flush = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  wallMs = 1_000_000
  nodes.length = 0
  gains.length = 0
  decoded.clear()
  vi.spyOn(Date, 'now').mockImplementation(() => wallMs)
  vi.spyOn(performance, 'now').mockImplementation(() => wallMs)
  vi.mocked(getTrack).mockImplementation(
    async (_variant: string, trackId: string) =>
      ({
        arrayBuffer: async () => new TextEncoder().encode(trackId).buffer,
      }) as unknown as Blob,
  )
  vi.mocked(openTrackStream).mockImplementation(async (blob: Blob) => fakeStream(new TextDecoder().decode(await blob.arrayBuffer())))
})
afterEach(() => {
  __resetStemsForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const audioNow = () => ctx.currentTime
const sorted = () => nodes.filter((n) => !Number.isNaN(n.when)).sort((a, b) => a.when - b.when)
/** Plays `ms` of song in 16 ms frames from song time `fromMs`. */
async function run(fromMs: number, ms: number, skew: (t: number) => number = () => 0) {
  for (let t = 0; t <= ms; t += 16) {
    syncStems(() => fromMs + t + skew(t), true)
    wallMs += 16
    await vi.advanceTimersByTimeAsync(16)
  }
  await flush()
}
/** Every scheduled piece starts exactly where the previous one ends - no gap, no overlap. */
function expectGapless(list: FakeNode[]) {
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1]
    const end = prev.when + (prev.buffer!.duration - prev.offset) / prev.rate
    expect(list[i].when).toBeCloseTo(end, 6)
  }
}

describe('stemEngine (docs/22 §3)', () => {
  const STEMS = ['drums', 'bass', 'guitar']

  it('starts every stem at the same audio time and position, each gapless', async () => {
    expect(await loadStems('v', STEMS)).toBe(true)
    const at = audioNow()
    syncStems(() => 42_000, true)
    await flush()
    // Each stem's first piece plays at the same moment, from the same song position.
    const starts = new Set(
      sorted()
        .filter((n) => Math.abs(n.when - (at + 0.4)) < 1e-6)
        .map((n) => n.out),
    )
    expect(starts.size).toBe(STEMS.length)
    for (const out of starts) expectGapless(sorted().filter((n) => n.out === out))
    expect(__stemStatsForTests().starts).toBe(1)
  })

  it('plays the start of the song from the heads decoded while loading', async () => {
    await loadStems('v', STEMS)
    const at = audioNow()
    syncStems(() => 0, true)
    // Scheduled right away, before any streaming: one 1.5 s head per stem, all at the same moment.
    const heads = sorted().filter((n) => Math.abs(n.when - (at + 0.4)) < 1e-6)
    expect(heads).toHaveLength(STEMS.length)
    expect(heads.every((n) => Math.abs(n.buffer!.duration - 1.5) < 1e-6 && Math.abs(n.offset - 0.4) < 1e-6)).toBe(true)
    await flush()
    for (const out of new Set(heads.map((n) => n.out))) expectGapless(sorted().filter((n) => n.out === out))
  })

  it('applies level, Stumm and Solo as gains per stem, also mid-song', async () => {
    await loadStems('v', STEMS)
    setStemGains(
      new Map([
        ['drums', 0.5],
        ['bass', 0],
        ['guitar', 1],
      ]),
    )
    // One gain node per stem (created in order), each moved to its new level.
    const stemGains = gains.slice(1, 4)
    expect(stemGains.map((g) => g.gain.setTargetAtTime.mock.calls[g.gain.setTargetAtTime.mock.calls.length - 1]?.[0])).toEqual([0.5, 0, 1])
  })

  it('restarts all stems at the new position after a jump', async () => {
    await loadStems('v', STEMS)
    await run(10_000, 500)
    const before = nodes.length
    await run(60_000, 300)
    expect(__stemStatsForTests().reschedules).toBe(1)
    const restarted = nodes.slice(before).filter((n) => !Number.isNaN(n.when))
    expect(new Set(restarted.map((n) => n.out)).size).toBe(STEMS.length)
  })

  it('stops when playback stops', async () => {
    await loadStems('v', STEMS)
    await run(5_000, 200)
    syncStems(() => null, false)
    expect(sorted().every((n) => n.stoppedAt !== null || n.when > audioNow() + 10)).toBe(true)
  })
})

describe('stemEngine - a section jump in Solo Üben (#479, 2026-10-22)', () => {
  it('brings the target in at the bar line, crossfaded, and keeps it without a restart', async () => {
    await loadStems('v', ['mix'])
    // Song 10 s at the start; the jump: at song 14 s back to 4 s (id = its wall time).
    const startWall = wallMs
    const jump = { id: 1, boundaryMs: 14_000, toMs: 4_000 }
    const song = () => {
      const t = 10_000 + (wallMs - startWall)
      return t >= jump.boundaryMs ? jump.toMs + (t - jump.boundaryMs) : t
    }
    const audioAtSong = audioNow() + (14 - 10)
    for (let i = 0; i < 400; i++) {
      syncStems(song, true, () => (10_000 + (wallMs - startWall) < 14_500 ? jump : null))
      wallMs += 16
      await vi.advanceTimersByTimeAsync(16)
    }
    await flush()
    const stats = __stemStatsForTests()
    expect(stats.jumps).toBe(1)
    expect(stats.reschedules).toBe(0)
    // The target's first piece starts 15 ms before the bar line, 15 ms before 4 s in the song.
    const target = sorted().find((n) => Math.abs(n.when - (audioAtSong - 0.015)) < 0.02 && n.stoppedAt === null)
    expect(target).toBeDefined()
    // The section before plays out under the crossfade (200 ms), then stops.
    const old = sorted().filter((n) => n.when < audioAtSong - 0.1 && n.stoppedAt !== null)
    expect(old.length).toBeGreaterThan(0)
    expect(Math.max(...old.map((n) => n.stoppedAt!))).toBeCloseTo(audioAtSong - 0.015 + 0.2, 2)
  })
})

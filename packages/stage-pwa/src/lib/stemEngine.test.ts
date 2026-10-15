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
      gain: { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
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

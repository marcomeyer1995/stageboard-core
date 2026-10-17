import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTrack } from './songVariantsDb'
import { openTrackStream, type TrackStream } from './trackStream'
import {
  __resetWebAudioTrackForTests,
  __webAudioTrackStatsForTests,
  getWebAudioTrackDurationMs,
  jumpCrossfadeMs,
  loadWebAudioTrack,
  preloadWebAudioTrack,
  syncWebAudioTrack,
} from './webAudioTrackEngine'

vi.mock('./songVariantsDb', () => ({ getTrack: vi.fn() }))
vi.mock('./trackStream', () => ({ openTrackStream: vi.fn() }))

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
  return { id, duration: length / SR, length, sampleRate: SR, numberOfChannels: 2, getChannelData: () => new Float32Array(length), copyToChannel: () => {} }
}

/** The wall clock; the fake audio clock runs with it. */
let wallMs = 0
interface FakeNode {
  buffer: FakeBuffer | null
  when: number
  offset: number
  stoppedAt: number | null
  rate: number
}
const nodes: FakeNode[] = []
const ctx = {
  state: 'running',
  get currentTime() {
    return wallMs / 1000 + 100
  },
  destination: {},
  resume: vi.fn(async () => {}),
  decodeAudioData: vi.fn(async (data: ArrayBuffer) => fakeBuffer(`full:${new TextDecoder().decode(data)}`, DURATION_S)),
  createBuffer: (_channels: number, length: number) => fakeBuffer('joined', length / SR),
  createGain: () => ({ gain: { setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setValueCurveAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn() }),
  createBufferSource: () => {
    const node: FakeNode = { buffer: null, when: NaN, offset: NaN, stoppedAt: null, rate: 1 }
    nodes.push(node)
    return {
      set buffer(b: FakeBuffer) {
        node.buffer = b
      },
      connect: vi.fn(),
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
        yield { buffer: fakeBuffer(id, PIECE_S) as unknown as AudioBuffer, timestamp: i * PIECE_S }
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
  decoded.clear()
  vi.spyOn(Date, 'now').mockImplementation(() => wallMs)
  vi.spyOn(performance, 'now').mockImplementation(() => wallMs)
  vi.mocked(getTrack).mockImplementation(async (_variant: string, trackId: string) => ({ arrayBuffer: async () => new TextEncoder().encode(trackId).buffer }) as unknown as Blob)
  vi.mocked(openTrackStream).mockImplementation(async (blob: Blob) => fakeStream(new TextDecoder().decode(await blob.arrayBuffer())))
})
afterEach(() => {
  __resetWebAudioTrackForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const audioNow = () => ctx.currentTime
const sorted = () => nodes.filter((n) => !Number.isNaN(n.when)).sort((a, b) => a.when - b.when)
/** Plays `ms` of song in 16 ms frames from song time `fromMs`. */
async function run(fromMs: number, ms: number, skew: (t: number) => number = () => 0) {
  for (let t = 0; t <= ms; t += 16) {
    syncWebAudioTrack(() => fromMs + t + skew(t), true)
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

describe('webAudioTrackEngine, streaming (#468)', () => {
  it('starts exactly on song time 0 after the count-in, from the decoded head, then continues gaplessly', async () => {
    await loadWebAudioTrack('v', 'a')
    syncWebAudioTrack(() => -3_000, true)
    expect(nodes).toHaveLength(0)
    wallMs += 2_000
    const at = audioNow()
    syncWebAudioTrack(() => -1_000, true)
    await flush()
    const list = sorted()
    expect(list[0].when).toBeCloseTo(at + 1, 6)
    expect(list[0].offset).toBe(0)
    expect(list[0].buffer!.duration).toBeCloseTo(1.5, 6) // the head, decoded before Play
    expect(list.length).toBeGreaterThan(3)
    expectGapless(list)
  })

  it('starts mid-song at the exact position - also beyond the decoded head', async () => {
    await loadWebAudioTrack('v', 'a')
    const at = audioNow()
    syncWebAudioTrack(() => 42_000, true)
    await flush()
    const list = sorted()
    expect(list[0].when).toBeCloseTo(at + 0.4, 6)
    expect(list[0].offset).toBeCloseTo(0, 6) // the piece at 42.4 s plays from its start
    expectGapless(list)
  })

  it('decodes only a few seconds ahead of playback, not the whole song', async () => {
    await loadWebAudioTrack('v', 'a')
    syncWebAudioTrack(() => 10_000, true)
    await flush(60)
    expect(decoded.get('a')! * PIECE_S).toBeLessThan(10) // head (1.5 s) + about 4-5 s, not 180 s
  })

  it('skipping two songs fast and pressing Play never plays another song; the skipped one is never decoded', async () => {
    await loadWebAudioTrack('v', 'acdc')
    await run(10_000, 200)
    syncWebAudioTrack(() => null, false)
    let release: () => void = () => {}
    vi.mocked(getTrack).mockImplementation(async (_variant: string, trackId: string) => {
      if (trackId === 'skipped') await new Promise<void>((resolve) => (release = resolve))
      return { arrayBuffer: async () => new TextEncoder().encode(trackId).buffer } as unknown as Blob
    })
    void loadWebAudioTrack('v', 'skipped')
    await flush()
    const before = nodes.length
    await loadWebAudioTrack('v', 'knocking')
    release()
    await flush()
    await run(0, 500)
    const played = nodes.slice(before).map((n) => n.buffer!.id)
    expect(played.length).toBeGreaterThan(0)
    expect(played.every((id) => id === 'knocking' || id === 'joined')).toBe(true)
    expect(decoded.get('skipped') ?? 0).toBe(0)
  })

  it('the next song is prepared in advance - Play on it needs no further preparation', async () => {
    await loadWebAudioTrack('v', 'a')
    preloadWebAudioTrack('v', 'b')
    await flush()
    const opened = vi.mocked(openTrackStream).mock.calls.length
    await loadWebAudioTrack('v', 'b')
    expect(vi.mocked(openTrackStream).mock.calls.length).toBe(opened)
    expect(getWebAudioTrackDurationMs()).toBe(DURATION_S * 1000)
  })

  it('a format this device cannot stream falls back to decoding the whole file', async () => {
    vi.mocked(openTrackStream).mockResolvedValue(null)
    await loadWebAudioTrack('v', 'flac')
    syncWebAudioTrack(() => 5_000, true)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].buffer!.id).toBe('full:flac')
    expect(nodes[0].offset).toBeCloseTo(5.15, 6)
  })

  it('a jump in song time restarts at the new position after two readings - crossfaded, no gap', async () => {
    await loadWebAudioTrack('v', 'a')
    await run(10_000, 1_000)
    const oldNodes = [...nodes]
    syncWebAudioTrack(() => 60_000, true)
    expect(__webAudioTrackStatsForTests().reschedules).toHaveLength(0)
    wallMs += 50
    syncWebAudioTrack(() => 60_050, true)
    await flush()
    expect(__webAudioTrackStatsForTests().reschedules).toHaveLength(1)
    const fresh = nodes.filter((n) => !oldNodes.includes(n)).sort((a, b) => a.when - b.when)
    const newStart = fresh[0].when
    expect(oldNodes.filter((n) => n.when < newStart).every((n) => n.stoppedAt! >= newStart)).toBe(true)
  })

  it('a single stale reading changes nothing', async () => {
    await loadWebAudioTrack('v', 'a')
    await run(10_000, 1_000)
    wallMs += 50
    syncWebAudioTrack(() => 11_066 - 130, true)
    expect(__webAudioTrackStatsForTests().lastErrorMs).toBeGreaterThan(100)
    wallMs += 50
    await run(11_116, 1_000)
    expect(__webAudioTrackStatsForTests().reschedules).toHaveLength(0)
  })

  it('works off clock drift by at most 0.1 % on the pieces scheduled next - still gapless', async () => {
    await loadWebAudioTrack('v', 'a')
    await run(10_000, 30_000, (t) => t * 0.0005) // song clock runs 0.05 % fast
    expect(__webAudioTrackStatsForTests().reschedules).toHaveLength(0)
    const rates = nodes.map((n) => n.rate)
    expect(Math.max(...rates)).toBeLessThanOrEqual(1.001)
    expect(Math.max(...rates)).toBeGreaterThan(1)
    expectGapless(sorted())
    expect(__webAudioTrackStatsForTests().late).toBe(0) // nothing decoded too late = no gap
  })

  it('a song change stops the old track and plays the new one', async () => {
    await loadWebAudioTrack('v', 'a')
    preloadWebAudioTrack('v', 'b')
    await run(10_000, 500)
    const old = [...nodes]
    await loadWebAudioTrack('v', 'b')
    await run(0, 500)
    expect(old.every((n) => n.stoppedAt !== null)).toBe(true)
    expect(nodes.some((n) => !old.includes(n))).toBe(true)
  })
})

describe('webAudioTrackEngine, section jump in the show (#479)', () => {
  it('the target section comes in exactly at the boundary - the old voice ends there, no restart after it', async () => {
    await loadWebAudioTrack('v', 'a')
    // Playing from 10 s; at song 12 s the band jumps back to 4 s.
    const jump = { id: 1, boundaryMs: 12_000, toMs: 4_000 }
    const startWall = wallMs
    const song = () => {
      const old = 10_000 + (wallMs - startWall)
      return old >= jump.boundaryMs ? jump.toMs + (old - jump.boundaryMs) : old
    }
    // After the jump the master folds it (no jump any more); the song clock drifts a little, so
    // the engine corrects its rate - which once made it think the jump was called off and restart.
    const jumpAt = () => (wallMs - startWall < 2_300 ? jump : null)
    const drifting = () => song() + (wallMs - startWall) * 0.003
    syncWebAudioTrack(song, true, jumpAt)
    for (let t = 0; t < 8_000; t += 16) {
      syncWebAudioTrack(wallMs - startWall < 2_300 ? song : drifting, true, jumpAt)
      wallMs += 16
      await vi.advanceTimersByTimeAsync(16)
    }
    await flush()
    const stats = __webAudioTrackStatsForTests()
    expect(stats.jumps).toBe(1)
    expect(stats.reschedules).toHaveLength(0)
    expect(stats.starts).toBe(2)
    // Song 12 s is reached 2 s after the start - that audio moment is the boundary.
    const boundaryAt = 100 + (startWall + 2_000) / 1000
    // The first voice's pieces (stopped at the jump) and the target's (still playing).
    const before = nodes.filter((n) => n.when < boundaryAt && n.stoppedAt !== null)
    const after = nodes.filter((n) => n.stoppedAt === null)
    // Nothing of the old song sounds past the boundary (beyond the short fade) ...
    // The old section fades out over 80 ms from 15 ms before the bar line ...
    expect(before.every((n) => n.stoppedAt !== null && n.stoppedAt <= boundaryAt + 0.066)).toBe(true)
    // ... while the target comes in, from 15 ms before its own start.
    const targetStart = Math.min(...after.map((n) => n.when))
    expect(Math.abs(targetStart - (boundaryAt - 0.015))).toBeLessThan(0.002)
  })
})

describe('webAudioTrackEngine, crossfade length per device (#479)', () => {
  afterEach(() => localStorage.removeItem('sb:audio:jump-crossfade-ms'))

  it('uses the length set on this device', async () => {
    localStorage.setItem('sb:audio:jump-crossfade-ms', '150')
    expect(jumpCrossfadeMs()).toBe(150)
    await loadWebAudioTrack('v', 'a')
    const jump = { id: 1, boundaryMs: 12_000, toMs: 4_000 }
    const startWall = wallMs
    const song = () => {
      const old = 10_000 + (wallMs - startWall)
      return old >= jump.boundaryMs ? jump.toMs + (old - jump.boundaryMs) : old
    }
    for (let t = 0; t < 3_000; t += 16) {
      syncWebAudioTrack(song, true, () => jump)
      wallMs += 16
      await vi.advanceTimersByTimeAsync(16)
    }
    await flush()
    const boundaryAt = 100 + (startWall + 2_000) / 1000
    const old = nodes.filter((n) => n.when < boundaryAt && n.stoppedAt !== null)
    expect(Math.max(...old.map((n) => n.stoppedAt!))).toBeCloseTo(boundaryAt - 0.015 + 0.15, 2)
  })

  it('falls back to 80 ms for nothing or nonsense stored', () => {
    expect(jumpCrossfadeMs()).toBe(80)
    localStorage.setItem('sb:audio:jump-crossfade-ms', '5000')
    expect(jumpCrossfadeMs()).toBe(80)
  })
})


import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTrack } from './songVariantsDb'
import {
  __getAudioElForTests,
  getLocalTrackDurationMs,
  loadLocalTrack,
  playLocalTrack,
  stopLocalTrack,
  __resetLocalAudioForTests,
  syncLocalTrackPosition,
} from './localAudioEngine'

// getTrack hits PouchDB for real otherwise - not needed to exercise this module's own logic.
vi.mock('./songVariantsDb', () => ({ getTrack: vi.fn() }))

beforeEach(() => {
  vi.mocked(getTrack).mockResolvedValue(new Blob(['fake-audio'], { type: 'audio/mpeg' }))
})

afterEach(() => {
  // These tests share the module-level <audio> singleton (localAudioEngine.ts's own design -
  // one element reused across calls) - always end each test paused/rewound so the next one
  // starts from a clean, deterministic state.
  __resetLocalAudioForTests()
})

function currentTimeMs(): number {
  return Math.round(__getAudioElForTests().currentTime * 1000)
}

describe('loadLocalTrack', () => {
  it('cues the loaded track to the given position, not always 0 (#13 found live, 2026-09-10: a device becoming the claimed output mid-song used to always start from the beginning)', async () => {
    const result = await loadLocalTrack('v1', 't1', 42_500)
    expect(result.status).toBe('ok')
    expect(currentTimeMs()).toBe(42_500)
  })
})

describe('playLocalTrack', () => {
  it('seeks to the given position before playing, rather than resuming from wherever the element happened to be cued', () => {
    playLocalTrack(12_340)
    expect(currentTimeMs()).toBe(12_340)
  })

  it("waits for a still-in-flight loadLocalTrack before touching the element (found live, 2026-09-16: a play attempt racing ahead of the load it depends on rejected for an unrelated reason, misreported as the browser's autoplay policy)", async () => {
    let resolveTrack!: (blob: Blob) => void
    vi.mocked(getTrack).mockReturnValueOnce(new Promise((resolve) => { resolveTrack = resolve }))

    const loadPromise = loadLocalTrack('v1', 't1', 30_000)
    const playPromise = playLocalTrack(12_340) // fired before the load above has resolved

    // The load hasn't resolved yet - playLocalTrack must not have touched currentTime yet either.
    expect(currentTimeMs()).toBe(0)

    resolveTrack(new Blob(['fake-audio'], { type: 'audio/mpeg' }))
    await loadPromise
    await playPromise

    // Once the load finally resolves, playLocalTrack's own seek takes effect (not the load's).
    expect(currentTimeMs()).toBe(12_340)
  })
})

describe('getLocalTrackDurationMs (#231)', () => {
  // jsdom's <audio> never actually decodes media, so `duration` stays NaN forever - these tests
  // fake the browser's own post-metadata-load state directly on the shared element, the same
  // "no real audio pipeline available under test" workaround useAudioOutputDriver.test.tsx's
  // mocks apply one level up.
  afterEach(() => {
    Object.defineProperty(__getAudioElForTests(), 'duration', { value: NaN, configurable: true })
  })

  it('is null before any track has been loaded (or duration genuinely not parsed yet)', () => {
    expect(getLocalTrackDurationMs()).toBeNull()
  })

  it('reads the element\'s real, browser-reported duration once known, converted to ms', () => {
    Object.defineProperty(__getAudioElForTests(), 'duration', { value: 183.5, configurable: true })
    expect(getLocalTrackDurationMs()).toBeCloseTo(183_500)
  })
})

describe('syncLocalTrackPosition (#468)', () => {
  let clock = 0
  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => vi.restoreAllMocks())

  const audio = () => __getAudioElForTests()
  /** Advances the wall clock and the element's position by `positionMs` (= what the output played). */
  function advance(ms: number, positionMs = ms) {
    clock += ms
    audio().currentTime += positionMs / 1000
  }
  /** Starts at `atMs` and lets the output come up, so the correction is active. */
  async function startRunning(atMs: number) {
    await playLocalTrack(atMs)
    syncLocalTrackPosition(atMs)
    advance(200)
    syncLocalTrackPosition(atMs + 200)
    expect(audio().playbackRate).toBe(1)
    return atMs + 200
  }

  it('does nothing while paused - only an actively playing element is corrected', () => {
    syncLocalTrackPosition(50_000)
    expect(currentTimeMs()).toBe(0)
  })

  /** Runs `ms` of playback in 16 ms frames; the master clock runs `ahead` ms ahead of the
   * position the whole time, the element advances at its own playbackRate. */
  function playFrames(ms: number, clockAt: () => number) {
    for (let t = 0; t < ms; t += 16) {
      advance(16, 16 * audio().playbackRate)
      syncLocalTrackPosition(clockAt())
    }
  }

  it('leaves jitter alone - no speed change at all while the drift stays under 80 ms', async () => {
    const at = await startRunning(10_000)
    const rates = new Set<number>()
    let i = 0
    playFrames(5_000, () => {
      rates.add(audio().playbackRate)
      return currentTimeMs() + (i++ % 2 ? 60 : -60) // ±60 ms jitter
    })
    expect([...rates]).toEqual([1])
    expect(currentTimeMs()).toBeGreaterThan(at)
  })

  it('works off a lasting drift at one fixed speed, then goes back to normal - two changes, no seek (pitch kept)', async () => {
    let clock = await startRunning(10_000)
    clock += 300 // the track is 300 ms behind from here on
    const changes: number[] = []
    let last = audio().playbackRate
    const start = currentTimeMs()
    for (let t = 0; t < 20_000; t += 16) {
      clock += 16
      advance(16, 16 * audio().playbackRate)
      syncLocalTrackPosition(clock)
      if (audio().playbackRate !== last) changes.push((last = audio().playbackRate))
    }
    expect(changes).toEqual([1.03, 1])
    expect(audio().preservesPitch).toBe(true)
    expect(Math.abs(currentTimeMs() - clock)).toBeLessThan(40)
    expect(currentTimeMs() - start).toBeLessThan(20_500) // caught up by speed, never seeked
  })

  it('seeks for a drift over a second, but never within 3 s of the last start/seek', async () => {
    let at = await startRunning(10_000)
    syncLocalTrackPosition(at + 5_000)
    expect(currentTimeMs()).toBe(at) // 200 ms after the start: too early
    advance(3_000)
    at += 3_000
    syncLocalTrackPosition(at + 5_000)
    expect(currentTimeMs()).toBe(at + 5_000)
    advance(2_500)
    syncLocalTrackPosition(at + 20_000)
    expect(currentTimeMs()).toBe(at + 7_500)
  })

  it('waits after a seek until the output runs again - no seek loop on a slow-starting output (S26+ over Bluetooth)', async () => {
    await playLocalTrack(10_000)
    // The output stands still for 600 ms after the start; the master clock keeps going.
    for (let t = 16; t <= 600; t += 16) {
      advance(16, 0)
      syncLocalTrackPosition(10_000 + t)
      expect(currentTimeMs()).toBe(10_000)
      expect(audio().playbackRate).toBe(1)
    }
    // Then it runs: once it advanced over the settle window, the 600 ms lag is worked off by speed.
    for (let i = 0; i < 25; i++) {
      advance(16)
      syncLocalTrackPosition(10_600 + 16 * (i + 1))
    }
    expect(audio().playbackRate).toBeCloseTo(1.03)
    expect(currentTimeMs()).toBeLessThan(10_500) // never seeked
  })

  it('a start resets the speed to normal', async () => {
    await startRunning(10_000)
    playFrames(1_000, () => currentTimeMs() + 300) // 300 ms behind for a second
    expect(audio().playbackRate).toBeCloseTo(1.03)
    await playLocalTrack(0)
    expect(audio().playbackRate).toBe(1)
  })
})

describe('stopping cleanly (2026-09-27)', () => {
  // happy-dom's <audio> has no real playback; `paused` is what these tests drive.
  function playing(): HTMLAudioElement {
    const audio = __getAudioElForTests()
    Object.defineProperty(audio, 'paused', { configurable: true, value: false })
    audio.volume = 0.8
    return audio
  }

  afterEach(() => {
    vi.useRealTimers()
    delete (__getAudioElForTests() as unknown as Record<string, unknown>).paused
  })

  it('fades out, then pauses - without seeking back to 0 (that made the tablet emit noise)', () => {
    vi.useFakeTimers()
    const audio = playing()
    audio.currentTime = 42
    const pause = vi.spyOn(audio, 'pause')
    stopLocalTrack()
    vi.advanceTimersByTime(30)
    expect(audio.volume).toBeGreaterThan(0)
    expect(audio.volume).toBeLessThan(0.8)
    expect(pause).not.toHaveBeenCalled()

    vi.advanceTimersByTime(40)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(audio.volume).toBeCloseTo(0.8) // restored for the next play
    expect(audio.currentTime).toBe(42)
  })

  it('a Play during the fade cancels it, so the new playback is not paused a moment later', async () => {
    vi.useFakeTimers()
    const audio = playing()
    const pause = vi.spyOn(audio, 'pause')
    vi.spyOn(audio, 'play').mockResolvedValue(undefined)
    stopLocalTrack()
    vi.advanceTimersByTime(20)
    await playLocalTrack(1_000)
    // Only pauses after the Play count (a load still in flight from an earlier test may swap the
    // element's source, which pauses it on its own).
    const pausesBefore = pause.mock.calls.length
    vi.advanceTimersByTime(100)
    expect(pause.mock.calls.length).toBe(pausesBefore)
    expect(audio.volume).toBeCloseTo(0.8)
  })
})

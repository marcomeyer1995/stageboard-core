import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTrack } from './songVariantsDb'
import {
  __getAudioElForTests,
  getLocalTrackDurationMs,
  loadLocalTrack,
  playLocalTrack,
  stopLocalTrack,
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
  stopLocalTrack()
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

describe('syncLocalTrackPosition', () => {
  it('does nothing while paused - only an actively playing element should ever be re-seeked', () => {
    stopLocalTrack() // ensures paused, position 0
    syncLocalTrackPosition(50_000)
    expect(currentTimeMs()).toBe(0)
  })

  it('does not correct a small drift - normal, inaudible <audio> clock jitter must not cause a seek', () => {
    playLocalTrack(10_000)
    syncLocalTrackPosition(10_100) // 100ms drift, under the 200ms threshold
    expect(currentTimeMs()).toBe(10_000)
  })

  it('corrects a large drift while playing - the backing-track equivalent of the click engine re-anchoring to the synced clock', () => {
    playLocalTrack(10_000)
    syncLocalTrackPosition(15_000) // 5s drift, well past the threshold
    expect(currentTimeMs()).toBe(15_000)
  })
})

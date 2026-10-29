import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClockStore } from '../store/useClockStore'
import { followPosition, RESYNC_MS, SILENT_VOLUME, useTrackClock, type TrackClock } from './useTrackClock'

let clock: TrackClock
function Player() {
  clock = useTrackClock('blob:track')
  return <audio {...clock.audioProps} />
}

afterEach(() => useClockStore.setState({ rate: 1 }))

describe('useTrackClock - slowed playback for tapping (2026-10-15)', () => {
  it('slows the element (pitch kept) and the clock alike, and is back to normal when leaving', () => {
    const { container, unmount } = render(<Player />)
    const audio = container.querySelector('audio')!
    act(() => clock.setRate(0.5))
    expect(audio.playbackRate).toBe(0.5)
    expect(audio.preservesPitch).toBe(true)
    expect(useClockStore.getState().rate).toBe(0.5)
    expect(clock.rate).toBe(0.5)
    unmount()
    expect(useClockStore.getState().rate).toBe(1)
  })
})

describe('useTrackClock - track level cues in the timeline (#485)', () => {
  it('sets the volume from the level curve on a seek and every frame while playing', () => {
    const level = { current: (ms: number) => (ms >= 10000 ? 0 : 1) }
    function Leveled() {
      clock = useTrackClock('blob:track', level)
      return <audio {...clock.audioProps} />
    }
    const { container } = render(<Leveled />)
    const audio = container.querySelector('audio')!
    expect(audio.volume).toBe(1)
    audio.currentTime = 12
    act(() => {
      audio.dispatchEvent(new Event('seeked'))
    })
    expect(audio.volume).toBe(SILENT_VOLUME)
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    try {
      audio.currentTime = 5
      act(() => {
        audio.dispatchEvent(new Event('play'))
      })
      // Every frame callback once (the clock's own elapsed-time loop asks for frames too).
      act(() => frames.splice(0).forEach((cb) => cb(0)))
      expect(audio.volume).toBe(1)
    } finally {
      raf.mockRestore()
    }
  })
})

describe('useTrackClock - followPosition (playhead pulsed, Redmi 2026-10-28)', () => {
  it('ignores the reports\' jitter, eases small deviations a tenth at a time, jumps on real ones', () => {
    expect(followPosition(1000, 1013)).toBe(1000)
    expect(followPosition(1000, 990)).toBe(1000)
    expect(followPosition(1000, 1030)).toBeCloseTo(1003)
    expect(followPosition(1000, 970)).toBeCloseTo(997)
    expect(followPosition(1000, 1000 + RESYNC_MS + 1)).toBe(1000 + RESYNC_MS + 1)
    expect(followPosition(5000, 2000)).toBe(2000)
  })
})

describe('useTrackClock - the clock starts when the element moves (playhead jumped back, Redmi 2026-10-28)', () => {
  it('stays at the start position until the element has moved, then runs from there', () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    try {
      const { container } = render(<Player />)
      const audio = container.querySelector('audio')!
      audio.currentTime = 22
      act(() => {
        audio.dispatchEvent(new Event('seeked'))
        audio.dispatchEvent(new Event('play'))
      })
      act(() => frames.splice(0).forEach((cb) => cb(0)))
      expect(useClockStore.getState().isRunning).toBe(false)
      expect(useClockStore.getState().getElapsedMs()).toBe(22000)
      // Android's first little step right at play is not the start yet.
      audio.currentTime = 22.017
      act(() => frames.splice(0).forEach((cb) => cb(0)))
      expect(useClockStore.getState().isRunning).toBe(false)
      audio.currentTime = 22.08
      act(() => frames.splice(0).forEach((cb) => cb(0)))
      expect(useClockStore.getState().isRunning).toBe(true)
      expect(useClockStore.getState().getElapsedMs()).toBeGreaterThanOrEqual(22080)
    } finally {
      raf.mockRestore()
      useClockStore.getState().stop()
    }
  })
})

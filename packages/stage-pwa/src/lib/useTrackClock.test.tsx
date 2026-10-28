import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClockStore } from '../store/useClockStore'
import { SILENT_VOLUME, useTrackClock, type TrackClock } from './useTrackClock'

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

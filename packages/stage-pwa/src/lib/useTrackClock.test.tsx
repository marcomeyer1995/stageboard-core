import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useClockStore } from '../store/useClockStore'
import { useTrackClock, type TrackClock } from './useTrackClock'

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

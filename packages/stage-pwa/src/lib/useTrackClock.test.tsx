import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useClockStore } from '../store/useClockStore'
import { followPosition, RESYNC_MS, useTrackClock, type TrackClock } from './useTrackClock'

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

describe('useTrackClock - followPosition (playhead pulsed, Redmi 2026-10-28)', () => {
  it('eases small deviations a tenth at a time and jumps on real ones', () => {
    expect(followPosition(1000, 1013)).toBeCloseTo(1001.3)
    expect(followPosition(1000, 990)).toBeCloseTo(999)
    expect(followPosition(1000, 1000 + RESYNC_MS + 1)).toBe(1000 + RESYNC_MS + 1)
    expect(followPosition(5000, 2000)).toBe(2000)
  })
})

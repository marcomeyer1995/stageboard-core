import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The song clock runs with the (fake) wall clock from the last seek.
const clock = vi.hoisted(() => ({ at: 0, wall: 0 }))
const show = vi.hoisted(() => ({
  mode: 'gig',
  playbackStatus: 'playing' as string,
  elapsedNow: () => clock.at + (Date.now() - clock.wall),
  queue: { currentArrangement: { chordProContent: '[00:01.00]Line\n[00:05.00] {alert: VAMP}\n[00:09.00]Line' } },
}))
vi.mock('./showMode', () => ({ useShowModeSong: () => show }))

const { useSongAlerts } = await import('./useSongAlerts')
const { LOCAL_FLASH_EVENT } = await import('./flash')

const seek = (ms: number) => {
  clock.at = ms
  clock.wall = Date.now()
}

describe('useSongAlerts (#26)', () => {
  const flashed: string[] = []
  const onFlash = (e: Event) => flashed.push((e as CustomEvent<{ text: string }>).detail.text)
  beforeEach(() => {
    vi.useFakeTimers()
    flashed.length = 0
    seek(4000)
    window.addEventListener(LOCAL_FLASH_EVENT, onFlash)
  })
  afterEach(() => {
    vi.useRealTimers()
    window.removeEventListener(LOCAL_FLASH_EVENT, onFlash)
  })

  it('flashes an alert once when the playing song passes its time', () => {
    renderHook(() => useSongAlerts())
    act(() => vi.advanceTimersByTime(900))
    expect(flashed).toEqual([])
    act(() => vi.advanceTimersByTime(300))
    expect(flashed).toEqual(['VAMP'])
    act(() => vi.advanceTimersByTime(1000))
    expect(flashed).toEqual(['VAMP'])
  })

  it('a jump back re-arms it', () => {
    renderHook(() => useSongAlerts())
    act(() => vi.advanceTimersByTime(1200))
    seek(2000)
    act(() => vi.advanceTimersByTime(150))
    act(() => vi.advanceTimersByTime(3300))
    expect(flashed).toEqual(['VAMP', 'VAMP'])
  })

  it('a jump forward over it skips it - the section it was in did not play', () => {
    renderHook(() => useSongAlerts())
    act(() => vi.advanceTimersByTime(150))
    seek(7000)
    act(() => vi.advanceTimersByTime(600))
    expect(flashed).toEqual([])
  })

  it('a late check after a stall still flashes what was passed', () => {
    renderHook(() => useSongAlerts())
    act(() => vi.advanceTimersByTime(150))
    // The main thread hung for 2 s: the next check comes late, song and wall clock moved alike.
    vi.setSystemTime(Date.now() + 2000)
    act(() => vi.advanceTimersByTime(150))
    expect(flashed).toEqual(['VAMP'])
  })
})

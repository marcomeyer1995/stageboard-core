import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clock = vi.hoisted(() => ({ ms: 0 }))
const show = vi.hoisted(() => ({
  mode: 'gig',
  playbackStatus: 'playing' as string,
  elapsedNow: () => clock.ms,
  queue: { currentVariant: { chordProContent: '[00:01.00]Line\n[00:05.00] {alert: VAMP}\n[00:09.00]Line' }, currentSong: null },
}))
vi.mock('./showMode', () => ({ useShowModeSong: () => show }))

const { useSongAlerts } = await import('./useSongAlerts')
const { LOCAL_FLASH_EVENT } = await import('./flash')

describe('useSongAlerts (#26)', () => {
  const flashed: string[] = []
  const onFlash = (e: Event) => flashed.push((e as CustomEvent<{ text: string }>).detail.text)
  beforeEach(() => {
    vi.useFakeTimers()
    flashed.length = 0
    clock.ms = 4000
    window.addEventListener(LOCAL_FLASH_EVENT, onFlash)
  })
  afterEach(() => {
    vi.useRealTimers()
    window.removeEventListener(LOCAL_FLASH_EVENT, onFlash)
  })

  it('flashes an alert once when the playing song passes its time', () => {
    renderHook(() => useSongAlerts())
    act(() => vi.advanceTimersByTime(150))
    expect(flashed).toEqual([])
    clock.ms = 5100
    act(() => vi.advanceTimersByTime(150))
    expect(flashed).toEqual(['VAMP'])
    clock.ms = 6000
    act(() => vi.advanceTimersByTime(300))
    expect(flashed).toEqual(['VAMP'])
  })

  it('a jump back re-arms it; nothing fires while paused', () => {
    renderHook(() => useSongAlerts())
    clock.ms = 5100
    act(() => vi.advanceTimersByTime(150))
    clock.ms = 2000 // seek back
    act(() => vi.advanceTimersByTime(150))
    clock.ms = 5200
    act(() => vi.advanceTimersByTime(150))
    expect(flashed).toEqual(['VAMP', 'VAMP'])
  })
})

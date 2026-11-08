import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Caps = Map<string, 'available' | 'degraded' | 'missing'>
const caps = vi.hoisted(() => ({ store: null as unknown as { getState: () => { value: Caps }; setState: (s: { value: Caps }) => void } }))
const append = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./useCapabilities', async () => {
  const { create: make } = await import('zustand')
  const store = make(() => ({ value: new Map() as Caps }))
  caps.store = store
  return { useCapabilities: () => store((s) => s.value) }
})
vi.mock('../store/useShowLogStore', async () => {
  const { create: make } = await import('zustand')
  return { useShowLogStore: make(() => ({ append })) }
})
vi.mock('../store/useShowStateStore', async () => {
  const { create: make } = await import('zustand')
  return {
    useShowStateStore: make(() => ({ master: true, state: { currentShowId: 'show-1' } })),
    drivesAutomation: (s: { master: boolean }) => s.master,
  }
})
vi.mock('../store/usePluginsStore', async () => {
  const { create: make } = await import('zustand')
  return { usePluginsStore: make(() => ({ healthReceived: true })) }
})

const { usePluginsStore } = await import('../store/usePluginsStore')
const { useShowLogTracker, CAPABILITY_SETTLE_MS } = await import('./useShowLogTracker')

const all = (status: 'available' | 'degraded'): Caps => new Map([['audio-playback', status], ['click-track', status]])
const setCaps = (value: Caps) => act(() => caps.store.setState({ value }))

beforeEach(() => {
  vi.useFakeTimers()
  append.mockClear()
  usePluginsStore.setState({ healthReceived: true })
  caps.store.setState({ value: all('available') })
})
afterEach(() => vi.useRealTimers())

describe('useShowLogTracker: capability changes (2026-11-08)', () => {
  it('a wobble that turns back within the settle time logs nothing', () => {
    renderHook(() => useShowLogTracker())
    setCaps(all('degraded'))
    act(() => vi.advanceTimersByTime(3000))
    setCaps(all('available'))
    act(() => vi.advanceTimersByTime(CAPABILITY_SETTLE_MS * 2))
    expect(append).not.toHaveBeenCalled()
  })

  it('a change that holds is logged once per capability, with the time it started', () => {
    renderHook(() => useShowLogTracker())
    const start = Date.now()
    setCaps(all('degraded'))
    act(() => vi.advanceTimersByTime(CAPABILITY_SETTLE_MS))
    expect(append).toHaveBeenCalledTimes(2)
    expect(append.mock.calls[0]![0]).toMatchObject({ type: 'capability-changed', from: 'available', to: 'degraded', at: start, showId: 'show-1' })
    act(() => vi.advanceTimersByTime(CAPABILITY_SETTLE_MS * 3))
    expect(append).toHaveBeenCalledTimes(2)
  })

  it('no baseline before the first plugin status: the master reloading does not log recoveries', () => {
    usePluginsStore.setState({ healthReceived: false })
    caps.store.setState({ value: all('degraded') })
    renderHook(() => useShowLogTracker())
    // In the app the first status and the capabilities computed from it land in the same render.
    act(() => {
      usePluginsStore.setState({ healthReceived: true })
      caps.store.setState({ value: all('available') })
    })
    act(() => vi.advanceTimersByTime(CAPABILITY_SETTLE_MS * 2))
    expect(append).not.toHaveBeenCalled()
  })
})

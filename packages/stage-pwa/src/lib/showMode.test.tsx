import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// showMode.ts -> queue.ts -> workspaceDb.ts constructs a real PouchDB at load time (see cueFiring.test.ts).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useShowElapsed, useShowMode, useShowModeSong } = await import('./showMode')
const { useShowStateStore } = await import('../store/useShowStateStore')

describe('useShowModeSong - for always-mounted hooks (#400 review)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('neither useShowModeSong nor useShowMode re-renders on every frame while playing (#457)', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: 0 } })
    let songRenders = 0
    let fullRenders = 0
    const song = renderHook(() => {
      songRenders++
      return useShowModeSong()
    })
    const full = renderHook(() => {
      fullRenders++
      return useShowMode()
    })
    for (let frame = 0; frame < 30; frame++) act(() => vi.advanceTimersByTime(17))
    expect(fullRenders).toBe(1)
    expect(songRenders).toBe(1)

    vi.setSystemTime(Date.now() + 2000)
    expect(song.result.current.playbackStatus).toBe('playing')
    expect(song.result.current.elapsedNow()).toBeGreaterThanOrEqual(2000)
    expect(full.result.current.elapsedNow()).toBeGreaterThanOrEqual(2000)
  })
})

describe('useShowElapsed (#457)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders again only when the selected value changes - once a second for a time text', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: 0 } })
    let renders = 0
    const hook = renderHook(() => {
      renders++
      return useShowElapsed((ms) => Math.floor((ms ?? 0) / 1000))
    })
    // Just over 3 s of frames: 185 frames, but only 3 changes of the shown second.
    for (let frame = 0; frame < 185; frame++) act(() => vi.advanceTimersByTime(1000 / 60))
    expect(hook.result.current).toBe(3)
    expect(renders).toBeLessThanOrEqual(5)
  })

  it('a pause renders the frozen position, and nothing ticks while paused', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: 0 } })
    let renders = 0
    const hook = renderHook(() => {
      renders++
      return useShowElapsed((ms) => ms)
    })
    act(() => vi.advanceTimersByTime(500))
    act(() => {
      useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, playbackStatus: 'paused', playbackStartedAt: null, playbackAccumulatedMs: 1234 } })
    })
    expect(hook.result.current).toBe(1234)
    const after = renders
    for (let frame = 0; frame < 30; frame++) act(() => vi.advanceTimersByTime(17))
    expect(renders).toBe(after)
  })

  it('a custom equality keeps objects from re-rendering when nothing shown changed', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: 0 } })
    let renders = 0
    renderHook(() => {
      renders++
      return useShowElapsed((ms) => ({ half: (ms ?? 0) >= 500 }), (a, b) => a.half === b.half)
    })
    for (let frame = 0; frame < 60; frame++) act(() => vi.advanceTimersByTime(17))
    expect(renders).toBe(2)
  })
})

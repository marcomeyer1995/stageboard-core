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

const { useShowMode, useShowModeSong } = await import('./showMode')
const { useShowStateStore } = await import('../store/useShowStateStore')

describe('useShowModeSong - for always-mounted hooks (#400 review)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not re-render on every frame while playing - useShowMode does', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, playbackStatus: 'playing', playbackStartedAt: Date.now(), playbackAccumulatedMs: 0 } })
    let songRenders = 0
    let fullRenders = 0
    const song = renderHook(() => {
      songRenders++
      return useShowModeSong()
    })
    renderHook(() => {
      fullRenders++
      return useShowMode()
    })
    for (let frame = 0; frame < 30; frame++) act(() => vi.advanceTimersByTime(17))
    expect(fullRenders).toBeGreaterThan(10)
    expect(songRenders).toBe(1)

    vi.setSystemTime(Date.now() + 2000)
    expect(song.result.current.playbackStatus).toBe('playing')
    expect(song.result.current.elapsedNow()).toBeGreaterThanOrEqual(2000)
  })
})

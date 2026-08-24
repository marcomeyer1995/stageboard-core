import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClockStore } from './useClockStore'

function resetStore() {
  useClockStore.setState({ isRunning: false, startedAt: null, accumulatedMs: 0 })
}

describe('useClockStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accumulates elapsed time while running', () => {
    const { start, getElapsedMs } = useClockStore.getState()
    start()
    vi.setSystemTime(2500)
    expect(getElapsedMs()).toBe(2500)
  })

  it('freezes elapsed time on stop', () => {
    const { start, stop, getElapsedMs } = useClockStore.getState()
    start()
    vi.setSystemTime(3000)
    stop()
    vi.setSystemTime(9000)
    expect(getElapsedMs()).toBe(3000)
  })

  it('resumes accumulating after a second start', () => {
    const { start, stop, getElapsedMs } = useClockStore.getState()
    start()
    vi.setSystemTime(1000)
    stop()
    vi.setSystemTime(5000)
    start()
    vi.setSystemTime(6200)
    expect(getElapsedMs()).toBe(2200)
  })

  it('reset zeroes elapsed time', () => {
    const { start, stop, reset, getElapsedMs } = useClockStore.getState()
    start()
    vi.setSystemTime(4000)
    stop()
    reset()
    expect(getElapsedMs()).toBe(0)
  })

  it('reset while running keeps it running from zero', () => {
    const { start, reset, getElapsedMs } = useClockStore.getState()
    start()
    vi.setSystemTime(1000)
    reset()
    vi.setSystemTime(1500)
    expect(getElapsedMs()).toBe(500)
    expect(useClockStore.getState().isRunning).toBe(true)
  })

  it('seek jumps to an arbitrary point while stopped', () => {
    const { seek, getElapsedMs } = useClockStore.getState()
    seek(9000)
    expect(getElapsedMs()).toBe(9000)
    expect(useClockStore.getState().isRunning).toBe(false)
  })

  it('seek jumps while running and keeps counting from there', () => {
    const { start, seek, getElapsedMs } = useClockStore.getState()
    start()
    vi.setSystemTime(1000)
    seek(9000)
    vi.setSystemTime(1500)
    expect(getElapsedMs()).toBe(9500)
  })

  it('seek clamps negative values to zero', () => {
    const { seek, getElapsedMs } = useClockStore.getState()
    seek(-500)
    expect(getElapsedMs()).toBe(0)
  })
})

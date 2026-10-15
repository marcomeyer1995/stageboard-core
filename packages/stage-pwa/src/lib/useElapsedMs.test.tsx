import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClockStore } from '../store/useClockStore'
import { useElapsedMs } from './useElapsedMs'

afterEach(() => {
  vi.useRealTimers()
  useClockStore.setState({ isRunning: false, startedAt: null, accumulatedMs: 0, rate: 1 })
})

describe('useElapsedMs', () => {
  it('advances at the clock rate - the slowed Timeline playhead does not run ahead (2026-10-15)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    useClockStore.setState({ isRunning: true, startedAt: 0, accumulatedMs: 30000, rate: 0.5 })
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useElapsedMs())
    expect(result.current).toBe(30500)
  })
})

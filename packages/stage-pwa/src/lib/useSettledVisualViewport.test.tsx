import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettledVisualViewport, VIEWPORT_SETTLE_MS } from './useVisualViewport'

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  vi.useRealTimers()
})

describe('useSettledVisualViewport (key bar jumped, Redmi 2026-10-28)', () => {
  it('skips the brief wrong height while the keyboard comes up and takes the one that holds', () => {
    vi.useFakeTimers()
    const viewport = Object.assign(new EventTarget(), { height: 1006, offsetTop: 0 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const { result } = renderHook(() => useSettledVisualViewport())
    expect(result.current?.height).toBe(1006)
    const resize = (height: number) =>
      act(() => {
        viewport.height = height
        viewport.dispatchEvent(new Event('resize'))
      })
    resize(297)
    act(() => vi.advanceTimersByTime(50))
    resize(652)
    act(() => vi.advanceTimersByTime(VIEWPORT_SETTLE_MS - 1))
    expect(result.current?.height).toBe(1006)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current?.height).toBe(652)
  })
})

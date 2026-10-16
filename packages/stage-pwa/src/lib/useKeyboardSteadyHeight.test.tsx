import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { isTyping, KEYBOARD_CLOSE_MS, useKeyboardSteadyHeight } from './useKeyboardSteadyHeight'

describe('useKeyboardSteadyHeight (Marco, 2026-10-16: the keyboard must not squeeze the dashboard)', () => {
  it('keeps the height while a text field has the focus, takes the real one after', async () => {
    const { container } = render(<input type="text" />)
    const input = container.querySelector('input')!
    const { result, rerender } = renderHook(({ w, h }) => useKeyboardSteadyHeight(w, h), { initialProps: { w: 800, h: 1200 } })
    act(() => input.focus())
    expect(isTyping()).toBe(true)
    rerender({ w: 800, h: 700 })
    expect(result.current).toBe(1200)
    // "Abbrechen": typing ends at once, the keyboard still covers the page for a moment.
    await act(async () => {
      input.blur()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    rerender({ w: 800, h: 700 })
    expect(result.current).toBe(1200)
    // Once it had its time, a still smaller height is real.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, KEYBOARD_CLOSE_MS + 100))
    })
    expect(result.current).toBe(700)
  })

  it('follows every change while nobody types, and a rotation even while typing', () => {
    const { container } = render(<input type="range" />)
    const { result, rerender } = renderHook(({ w, h }) => useKeyboardSteadyHeight(w, h), { initialProps: { w: 800, h: 1200 } })
    act(() => container.querySelector('input')!.focus())
    expect(isTyping()).toBe(false)
    rerender({ w: 800, h: 900 })
    expect(result.current).toBe(900)
    const text = render(<textarea />).container.querySelector('textarea')!
    act(() => text.focus())
    rerender({ w: 1200, h: 600 })
    expect(result.current).toBe(600)
  })
})

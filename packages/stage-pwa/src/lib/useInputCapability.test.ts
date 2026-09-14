import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHasCoarsePointer, useInputCapability } from './useInputCapability'

/** Each entry is a live, mutable MediaQueryList stand-in - tests flip `.matches` and fire the
 * registered 'change' listener themselves, since real matchMedia listeners never fire under
 * happy-dom on their own. */
function stubMatchMedia(initial: { fine: boolean; hover: boolean }) {
  const state = { ...initial }
  const listeners: Record<'(pointer: fine)' | '(hover: hover)', Array<() => void>> = {
    '(pointer: fine)': [],
    '(hover: hover)': [],
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: '(pointer: fine)' | '(hover: hover)') => ({
      get matches() {
        return query === '(pointer: fine)' ? state.fine : state.hover
      },
      addEventListener: (_: string, cb: () => void) => listeners[query].push(cb),
      removeEventListener: (_: string, cb: () => void) => {
        listeners[query] = listeners[query].filter((l) => l !== cb)
      },
    })),
  )
  return {
    set(next: Partial<typeof state>) {
      Object.assign(state, next)
      ;[...listeners['(pointer: fine)'], ...listeners['(hover: hover)']].forEach((cb) => cb())
    },
  }
}

function fireMouseMove(movementX: number, movementY: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { movementX, movementY } as MouseEventInit))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useInputCapability', () => {
  it('trusts the initial (pointer: fine) + (hover: hover) report on mount, no corroboration needed', () => {
    stubMatchMedia({ fine: true, hover: true })
    const { result } = renderHook(() => useInputCapability())
    expect(result.current).toBe('pointer')
  })

  it('defaults to touch when either (pointer: fine) or (hover: hover) is false', () => {
    stubMatchMedia({ fine: false, hover: true })
    expect(renderHook(() => useInputCapability()).result.current).toBe('touch')

    stubMatchMedia({ fine: true, hover: false })
    expect(renderHook(() => useInputCapability()).result.current).toBe('touch')
  })

  it('downgrades to touch immediately when the media query changes (e.g. a mouse unplugged)', () => {
    const media = stubMatchMedia({ fine: true, hover: true })
    const { result } = renderHook(() => useInputCapability())
    expect(result.current).toBe('pointer')

    act(() => media.set({ fine: false }))
    expect(result.current).toBe('touch')
  })

  it('does not upgrade to pointer on the media query alone - only after real mouse movement', () => {
    const media = stubMatchMedia({ fine: false, hover: false })
    const { result } = renderHook(() => useInputCapability())
    expect(result.current).toBe('touch')

    // A footswitch/click-only peripheral enumerating as a mouse can flip this without anyone
    // ever moving one - the media-query change alone must not be enough.
    act(() => media.set({ fine: true, hover: true }))
    expect(result.current).toBe('touch')

    act(() => fireMouseMove(3, 0))
    expect(result.current).toBe('pointer')
  })

  it('ignores a mousemove with zero movement (a click-only device dispatching a no-op event)', () => {
    // Starts as 'touch', then the media query flips fine+hover - a zero-movement event has
    // something to wrongly promote here if the movement guard were missing.
    const media = stubMatchMedia({ fine: false, hover: false })
    const { result } = renderHook(() => useInputCapability())
    act(() => media.set({ fine: true, hover: true }))

    act(() => fireMouseMove(0, 0))
    expect(result.current).toBe('touch')
  })
})

/** Independent of the `(pointer: fine)`/`(hover: hover)` queries above - a live, mutable
 * `(any-pointer: coarse)` stand-in. */
function stubCoarsePointer(initial: boolean) {
  const state = { matches: initial }
  const listeners: Array<() => void> = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return state.matches
      },
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: () => void) => {
        const i = listeners.indexOf(cb)
        if (i !== -1) listeners.splice(i, 1)
      },
    })),
  )
  return {
    set(next: boolean) {
      state.matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

describe('useHasCoarsePointer', () => {
  it('reflects (any-pointer: coarse) on mount', () => {
    stubCoarsePointer(true)
    expect(renderHook(() => useHasCoarsePointer()).result.current).toBe(true)

    stubCoarsePointer(false)
    expect(renderHook(() => useHasCoarsePointer()).result.current).toBe(false)
  })

  it('updates live (e.g. a 2-in-1 folding into/out of tablet posture)', () => {
    const media = stubCoarsePointer(false)
    const { result } = renderHook(() => useHasCoarsePointer())
    expect(result.current).toBe(false)

    act(() => media.set(true))
    expect(result.current).toBe(true)
  })
})

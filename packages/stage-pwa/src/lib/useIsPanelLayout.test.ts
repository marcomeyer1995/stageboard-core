import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIsPanelLayout } from './useIsPanelLayout'

/** Each entry is a live, mutable MediaQueryList stand-in, dispatched by substring - same
 * pattern SheetEditor.test.tsx's own stubViewport already uses, but with real listeners
 * (SheetEditor's stub is static-only) since these tests also check live recomputation. */
function stubMatchMedia(initial: { width1024: boolean; width768: boolean; landscape: boolean }) {
  const state = { ...initial }
  const listeners: Record<string, Array<() => void>> = {
    '(min-width: 1024px)': [],
    '(min-width: 768px)': [],
    '(orientation: landscape)': [],
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: '(min-width: 1024px)' | '(min-width: 768px)' | '(orientation: landscape)') => ({
      get matches() {
        if (query === '(min-width: 1024px)') return state.width1024
        if (query === '(min-width: 768px)') return state.width768
        return state.landscape
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
      Object.values(listeners)
        .flat()
        .forEach((cb) => cb())
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useIsPanelLayout', () => {
  it('true at plain desktop width, regardless of orientation', () => {
    stubMatchMedia({ width1024: true, width768: true, landscape: false })
    expect(renderHook(() => useIsPanelLayout()).result.current).toBe(true)
  })

  it('true on a landscape tablet below 1024px, as long as it clears 768px', () => {
    stubMatchMedia({ width1024: false, width768: true, landscape: true })
    expect(renderHook(() => useIsPanelLayout()).result.current).toBe(true)
  })

  it('false on a portrait tablet, even at/above 768px', () => {
    stubMatchMedia({ width1024: false, width768: true, landscape: false })
    expect(renderHook(() => useIsPanelLayout()).result.current).toBe(false)
  })

  it('false on phone portrait', () => {
    stubMatchMedia({ width1024: false, width768: false, landscape: false })
    expect(renderHook(() => useIsPanelLayout()).result.current).toBe(false)
  })

  it('recomputes live on rotation (landscape tablet -> portrait)', () => {
    const media = stubMatchMedia({ width1024: false, width768: true, landscape: true })
    const { result } = renderHook(() => useIsPanelLayout())
    expect(result.current).toBe(true)

    act(() => media.set({ landscape: false }))
    expect(result.current).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useElementSize, type ElementSize } from './useElementSize'

// Full control over exactly when/what the observer reports, rather than relying on
// happy-dom's own ResizeObserver (which doesn't compute real layout, so it wouldn't fire
// from a plain DOM mutation anyway) - each instance's callback is captured so a test can
// invoke it directly with an arbitrary contentRect.
let observed: ((entries: Pick<ResizeObserverEntry, 'contentRect'>[]) => void) | null = null
const disconnect = vi.fn()

class FakeResizeObserver {
  constructor(callback: (entries: Pick<ResizeObserverEntry, 'contentRect'>[]) => void) {
    observed = callback
  }
  observe() {}
  disconnect = disconnect
}

function fire(width: number, height: number) {
  observed?.([{ contentRect: { width, height } as DOMRectReadOnly }])
}

function Probe({ onApi, remeasureKey }: { onApi: (size: ElementSize) => void; remeasureKey?: string }) {
  const [ref, size] = useElementSize(remeasureKey)
  onApi(size)
  return <div ref={ref} />
}

describe('useElementSize', () => {
  afterEach(() => {
    observed = null
    disconnect.mockClear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('applies the first measurement immediately, not debounced', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let size!: ElementSize
    render(<Probe onApi={(s) => (size = s)} />)

    // jsdom/happy-dom's own clientWidth/clientHeight are 0 with no real layout engine - the
    // point here is just that *some* size was set synchronously on mount, not debounced.
    expect(size).toEqual({ width: 0, height: 0 })
  })

  it('coalesces a rapid burst of ResizeObserver firings into one settled value, instead of propagating every intermediate frame (#Dashboard.tsx "widgets jumping/resizing" - react-grid-layout resyncing against stale internal state on every prop change, found live 2026-09-15)', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let size!: ElementSize
    let renderCount = 0
    render(
      <Probe
        onApi={(s) => {
          size = s
          renderCount++
        }}
      />,
    )
    const countAfterMount = renderCount

    act(() => {
      fire(400, 300)
      fire(402, 300)
      fire(398, 301)
      fire(400, 300)
    })
    expect(renderCount).toBe(countAfterMount) // no re-render yet - still debouncing

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(size).toEqual({ width: 400, height: 300 })
    expect(renderCount).toBe(countAfterMount + 1) // exactly one settled update, not four
  })

  it('a new remeasureKey reads the size at once, before paint - no 150 ms with the old height (Marco 2026-10-17: dashboard without status bar)', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let size!: ElementSize
    let height = 600
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height)
    const { rerender } = render(<Probe remeasureKey="a" onApi={(s) => (size = s)} />)
    expect(size.height).toBe(600)

    height = 680
    act(() => fire(0, 680)) // the observer's own report is still debouncing
    rerender(<Probe remeasureKey="b" onApi={(s) => (size = s)} />)
    expect(size.height).toBe(680)
    vi.restoreAllMocks()
  })

  it('disconnects the observer and clears any pending debounce on unmount', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let size!: ElementSize
    const { unmount } = render(<Probe onApi={(s) => (size = s)} />)

    act(() => {
      fire(500, 400)
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(disconnect).toHaveBeenCalled()
    expect(size).toEqual({ width: 0, height: 0 }) // the debounced update never landed
  })
})

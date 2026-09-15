import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useDeferredSliderValue } from './useDeferredSliderValue'

function Probe({
  value,
  onCommit,
  onApi,
}: {
  value: number
  onCommit: (next: number) => void
  onApi: (api: { display: number; drag: (n: number) => void; flush: () => void }) => void
}) {
  const [display, drag, flush] = useDeferredSliderValue(value, onCommit)
  onApi({ display, drag, flush })
  return null
}

describe('useDeferredSliderValue', () => {
  it('updates the display value immediately without committing', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    let api!: { display: number; drag: (n: number) => void; flush: () => void }
    const { rerender } = render(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)

    api.drag(42)
    rerender(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)

    expect(api.display).toBe(42)
    expect(onCommit).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('commits the latest value once the debounce window elapses, coalescing rapid ticks into one write', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    let api!: { display: number; drag: (n: number) => void; flush: () => void }
    const { rerender } = render(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)

    api.drag(20)
    api.drag(30)
    api.drag(40)
    rerender(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)
    expect(onCommit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(40)
    vi.useRealTimers()
  })

  it('flush() commits immediately, e.g. on pointer-up, without waiting for the debounce window', () => {
    vi.useFakeTimers()
    const onCommit = vi.fn()
    let api!: { display: number; drag: (n: number) => void; flush: () => void }
    const { rerender } = render(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)

    api.drag(99)
    rerender(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)
    api.flush()

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(99)
    vi.useRealTimers()
  })

  it('follows an external value change when there is no pending local edit', () => {
    const onCommit = vi.fn()
    let api!: { display: number; drag: (n: number) => void; flush: () => void }
    const { rerender } = render(<Probe value={10} onCommit={onCommit} onApi={(a) => (api = a)} />)

    rerender(<Probe value={25} onCommit={onCommit} onApi={(a) => (api = a)} />)
    expect(api.display).toBe(25)
  })
})

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScrollOnceText } from './ScrollOnceText'

function fakeLayout(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
  const animation = { onfinish: null as null | (() => void), cancel: vi.fn() }
  const animate = vi.fn<(frames: Keyframe[], options?: KeyframeAnimationOptions) => typeof animation>(() => animation)
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true })
  return { animate, animation }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (HTMLElement.prototype as { animate?: unknown }).animate
})

describe('ScrollOnceText (#373)', () => {
  it('scrolls a too-long title through once per new song, then rests truncated', () => {
    const { animate, animation } = fakeLayout(400, 200)
    const { rerender } = render(<ScrollOnceText cycleKey="a">Wie ein schützender Engel</ScrollOnceText>)
    expect(animate).toHaveBeenCalledTimes(1)
    const frames = animate.mock.calls[0]![0] as Array<{ transform: string }>
    expect(frames[frames.length - 1]!.transform).toBe('translateX(-200px)')
    animation.onfinish?.()
    rerender(<ScrollOnceText cycleKey="a">Wie ein schützender Engel</ScrollOnceText>)
    expect(animate).toHaveBeenCalledTimes(1) // same song: no second pass
    rerender(<ScrollOnceText cycleKey="b">Bohemian Rhapsody</ScrollOnceText>)
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('leaves a title that fits alone', () => {
    const { animate } = fakeLayout(150, 200)
    render(<ScrollOnceText cycleKey="a">Kurz</ScrollOnceText>)
    expect(animate).not.toHaveBeenCalled()
    expect(screen.getByText('Kurz').className).toContain('truncate')
  })
})

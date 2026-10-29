import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFrameValue } from './useFrameValue'

describe('useFrameValue (#457)', () => {
  it('a new active period never starts with the value the last one left behind', () => {
    let pastEnd = true
    const seen: boolean[] = []
    const { rerender } = renderHook(({ active }) => {
      const v = useFrameValue(() => pastEnd, active)
      seen.push(v)
      return v
    }, { initialProps: { active: true } })
    // The song ran past its end, then stopped.
    rerender({ active: false })
    // A new song: not past its end - its very first render must say so.
    pastEnd = false
    seen.length = 0
    rerender({ active: true })
    expect(seen[0]).toBe(false)
    expect(seen.every((v) => v === false)).toBe(true)
  })

  it('reads at render while inactive', () => {
    let x = 1
    const { result, rerender } = renderHook(({ active }) => useFrameValue(() => x, active), { initialProps: { active: false } })
    expect(result.current).toBe(1)
    x = 2
    rerender({ active: false })
    expect(result.current).toBe(2)
  })
})

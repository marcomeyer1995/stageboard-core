import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverInBackground, dropFromInbox } from './inbox'

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => vi.unstubAllGlobals())

describe('inbox (docs/26 §3.1)', () => {
  it('applies a burst once, with the newest value, after the current task', async () => {
    const apply = vi.fn()
    for (let i = 1; i <= 7; i++) deliverInBackground('plugin-health:a', i, apply)
    expect(apply).not.toHaveBeenCalled()
    await nextTask()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(7)
  })

  it('keeps channels apart and drops a channel whose subscription ended', async () => {
    const health = vi.fn()
    const presence = vi.fn()
    deliverInBackground('plugin-health:a', 'h', health)
    deliverInBackground('presence:a', 'p', presence)
    dropFromInbox('presence:a')
    await nextTask()
    expect(health).toHaveBeenCalledWith('h')
    expect(presence).not.toHaveBeenCalled()
  })

  it('in idle time: stops when the slice runs out and finishes in the next one', () => {
    const slices: ((deadline: { timeRemaining: () => number; didTimeout: boolean }) => void)[] = []
    vi.stubGlobal('requestIdleCallback', (cb: (typeof slices)[number]) => slices.push(cb))
    vi.stubGlobal('cancelIdleCallback', () => {})
    const applied: string[] = []
    deliverInBackground('one', 'a', (v) => applied.push(v))
    deliverInBackground('two', 'b', (v) => applied.push(v))
    expect(slices).toHaveLength(1)
    slices.shift()!({ timeRemaining: () => 1, didTimeout: false })
    expect(applied).toEqual(['a'])
    expect(slices).toHaveLength(1)
    slices.shift()!({ timeRemaining: () => 10, didTimeout: false })
    expect(applied).toEqual(['a', 'b'])
  })

  it('a failing apply does not stop the others', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = vi.fn()
    deliverInBackground('bad', 1, () => {
      throw new Error('boom')
    })
    deliverInBackground('good', 2, ok)
    await nextTask()
    expect(ok).toHaveBeenCalledWith(2)
    err.mockRestore()
  })
})

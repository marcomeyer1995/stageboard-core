import { describe, expect, it, vi } from 'vitest'
import { coalesced } from './coalesced'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const NO_GAP = 0

describe('coalesced', () => {
  it('runs once more after the current run, however often it was called meanwhile', async () => {
    const runs: ReturnType<typeof deferred>[] = []
    const run = coalesced(() => {
      const d = deferred()
      runs.push(d)
      return d.promise
    }, NO_GAP)
    run()
    run()
    run()
    run()
    expect(runs).toHaveLength(1)
    runs[0].resolve()
    await flush()
    await flush()
    expect(runs).toHaveLength(2)
    runs[1].resolve()
    await flush()
    expect(runs).toHaveLength(2)
  })

  it('keeps going after a failed run', async () => {
    let calls = 0
    const run = coalesced(async () => {
      calls++
      if (calls === 1) throw new Error('boom')
    }, NO_GAP)
    run()
    run()
    await flush()
    await flush()
    await flush()
    expect(calls).toBe(2)
  })

  it('waits the gap before the extra run', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const run = coalesced(async () => {
        calls++
      }, 250)
      run()
      run()
      await vi.advanceTimersByTimeAsync(0)
      expect(calls).toBe(1)
      await vi.advanceTimersByTimeAsync(249)
      expect(calls).toBe(1)
      run()
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toBe(2)
      await vi.advanceTimersByTimeAsync(1000)
      expect(calls).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

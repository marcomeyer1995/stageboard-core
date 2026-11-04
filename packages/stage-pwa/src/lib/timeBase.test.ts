import { describe, expect, it } from 'vitest'
import { TimeBase } from './timeBase'

/**
 * A simulated Fire (docs/29 §10): the audio clock runs at +260 ppm against performance.now(),
 * `currentTime` jumps in 64 ms steps and renders 364 ms ahead of what is heard, the output
 * timestamps come every ~60 ms with a few ms of sawtooth and now and then a 68 ms outlier.
 */
function fakeFire(opts: { ppm?: number; bufferMs?: number; outlierEvery?: number } = {}) {
  const ppm = opts.ppm ?? 260
  let bufferMs = opts.bufferMs ?? 364
  let perf = 1_000_000
  let audioOffset = 5_000 // heard audio time (ms) at perf = 1_000_000
  let suspendedAt: number | null = null
  let n = 0
  const heard = (p: number) => audioOffset + (p - 1_000_000) * (1 + ppm * 1e-6)
  const ctx = {
    get state() {
      return suspendedAt === null ? 'running' : 'suspended'
    },
    get currentTime() {
      const rendered = (suspendedAt ?? heard(perf)) + bufferMs
      return (Math.floor(rendered / 64) * 64) / 1000
    },
    getOutputTimestamp() {
      // A new pair only every ~60 ms, a sawtooth of up to 4 ms, an outlier every so often.
      const stamp = Math.floor(perf / 60) * 60
      n++
      const saw = ((stamp / 60) % 5) * 0.8
      const outlier = opts.outlierEvery && n % opts.outlierEvery === 0 ? 68 : 0
      return { contextTime: (heard(stamp) + saw + outlier) / 1000, performanceTime: stamp }
    },
  } as unknown as AudioContext
  return {
    ctx,
    tick(ms: number) {
      perf += ms
    },
    perf: () => perf,
    /** The true audio clock in currentTime's sense (rendered = heard + buffer), s. */
    truth: () => (heard(perf) + bufferMs) / 1000,
    suspend() {
      suspendedAt = heard(perf)
    },
    setBuffer(ms: number) {
      bufferMs = ms
    },
    resume(lostMs: number) {
      audioOffset -= lostMs
      suspendedAt = null
    },
  }
}

function run(tb: TimeBase, dev: ReturnType<typeof fakeFire>, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    dev.tick(50)
    tb.sample(dev.ctx)
  }
}

describe('timeBase (docs/29 step 1)', () => {
  it('is not ready until it has seen enough of the clock', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 1_000)
    expect(tb.now(dev.ctx)).toBeNull()
    // A line after ~2 s, the buffer gap after 20 s more.
    run(tb, dev, 22_500)
    expect(tb.now(dev.ctx)).not.toBeNull()
  })

  it('reads the audio clock within 1 ms despite 64 ms steps, sawtooth and drift', () => {
    const dev = fakeFire({ outlierEvery: 37 })
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 25_000)
    const errors: number[] = []
    for (let i = 0; i < 400; i++) {
      run(tb, dev, 50)
      dev.tick(7) // read between samples, like an engine does
      errors.push(Math.abs(tb.now(dev.ctx)! - dev.truth()) * 1000)
    }
    // The fit carries the sawtooth's mean (~1.6 ms) into the line - the same for every engine and
    // every read, so it is a constant, not jitter.
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length
    expect(Math.max(...errors) - Math.min(...errors)).toBeLessThan(1)
    expect(mean).toBeLessThan(4)
    expect(tb.quality().ppm).toBeGreaterThan(200)
    expect(tb.quality().ppm).toBeLessThan(320)
  })

  it('keeps the buffer gap put while currentTime jumps around', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 25_000)
    const gap = tb.quality().gapMs!
    expect(gap).toBeGreaterThan(300)
    run(tb, dev, 60_000)
    // At most the edge's last few ms - never a jump.
    expect(Math.abs(tb.quality().gapMs! - gap)).toBeLessThan(3)
  })

  it('holds the buffer gap still while the edge only wobbles within a few ms', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 25_000)
    const gap = tb.quality().gapMs!
    for (let i = 0; i < 20; i++) {
      dev.setBuffer(364 + (i % 2 ? 2 : -2))
      run(tb, dev, 3_000)
    }
    expect(tb.quality().gapMs).toBe(gap)
  })

  it('moves a buffer gap that turns out off by at most 1 ms a second, never at once', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 25_000)
    const gap = tb.quality().gapMs!
    dev.setBuffer(364 + 16)
    run(tb, dev, 5_000)
    expect(tb.quality().gapMs! - gap).toBeLessThanOrEqual(5.5)
    run(tb, dev, 40_000)
    expect(tb.quality().gapMs! - gap).toBeGreaterThan(14)
    // And back down, just as gently.
    dev.setBuffer(364)
    const high = tb.quality().gapMs!
    run(tb, dev, 5_000)
    expect(high - tb.quality().gapMs!).toBeLessThanOrEqual(5.5)
  })

  it('is not ready while the context is suspended, and starts over after it lost time', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 25_000)
    dev.suspend()
    run(tb, dev, 3_000)
    expect(tb.now(dev.ctx)).toBeNull() // stale
    dev.resume(3_000)
    run(tb, dev, 500)
    expect(tb.now(dev.ctx)).toBeNull() // starting over, not extrapolating the old line
    run(tb, dev, 25_000)
    expect(Math.abs(tb.now(dev.ctx)! - dev.truth()) * 1000).toBeLessThan(4)
  })
})

describe('one time base (docs/29 §5.2)', () => {
  it('nothing but the time service reads the output timestamps', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && !path.endsWith('timeBase.ts') && readFileSync(path, 'utf8').includes('getOutputTimestamp')) offenders.push(path)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})

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
  let glitch: ((stampMs: number) => number) | null = null
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
      return { contextTime: (heard(stamp) + saw + outlier + (glitch?.(stamp) ?? 0)) / 1000, performanceTime: stamp }
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
    /** Output timestamps only read off (what is heard stays put) - null ends it. */
    setGlitch(fn: ((stampMs: number) => number) | null) {
      glitch = fn
    },
    /** What is heard (and rendered) really moves by this much. */
    shift(ms: number) {
      audioOffset += ms
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

  it("ignores a few seconds of output timestamps that read off and snap back (the Fire's, Gig 2026-11-04)", () => {
    const dev = fakeFire({ outlierEvery: 37 })
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 30_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    // -24 ms, drifting another 1 ms a second, for 5 s.
    const from = dev.perf()
    dev.setGlitch((stamp) => -24 - (stamp - from) / 1000)
    let worst = 0
    let worstPpm = 0
    for (let t = 0; t < 15_000; t += 50) {
      if (t === 5_000) dev.setGlitch(null)
      run(tb, dev, 50)
      worst = Math.max(worst, Math.abs(error() - before))
      worstPpm = Math.max(worstPpm, Math.abs(tb.quality().ppm! - 260))
    }
    expect(worst).toBeLessThan(0.5)
    expect(worstPpm).toBeLessThan(60)
  })

  it('ignores a glitch of 12 s that drifts (the Fire: -17 → -32 ms over 10 s)', () => {
    const dev = fakeFire({ outlierEvery: 37 })
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 30_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    // -17 ms, drifting another 1.5 ms a second, for 12 s - then back.
    const from = dev.perf()
    dev.setGlitch((stamp) => -17 - (1.5 * (stamp - from)) / 1000)
    let worst = 0
    for (let t = 0; t < 25_000; t += 50) {
      if (t === 12_000) dev.setGlitch(null)
      run(tb, dev, 50)
      worst = Math.max(worst, Math.abs(error() - before))
    }
    // The edge of what is left sits a little lower in this fake's 3.2 ms sawtooth (the Fire's
    // spread is 0.27 ms).
    expect(worst).toBeLessThan(1)
  })

  it("isn't tilted by a glitch that creeps in under the gate (the Fire: 0 → -22 ms over 16 s, then back)", () => {
    const dev = fakeFire({ outlierEvery: 37 })
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 40_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    const from = dev.perf()
    dev.setGlitch((stamp) => (-1.4 * (stamp - from)) / 1000)
    let worst = 0
    let worstPpm = 0
    for (let t = 0; t < 60_000; t += 50) {
      if (t === 16_000) dev.setGlitch(null)
      run(tb, dev, 50)
      worst = Math.max(worst, Math.abs(error() - before))
      worstPpm = Math.max(worstPpm, Math.abs(tb.quality().ppm! - 260))
    }
    expect(worst).toBeLessThan(1.5)
    expect(worstPpm).toBeLessThan(100)
  })

  it("doesn't flip with pairs that read 5 ms late every tenth time (the Redmi's)", () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    let n = 0
    dev.setGlitch(() => (++n % 10 === 0 ? 5 : 0))
    run(tb, dev, 30_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    let worst = 0
    for (let t = 0; t < 30_000; t += 50) {
      run(tb, dev, 50)
      worst = Math.max(worst, Math.abs(error() - before))
    }
    expect(worst).toBeLessThan(0.5)
  })

  it('follows a real move down too, once it filled the window', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 30_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    dev.shift(-20)
    run(tb, dev, 25_000)
    expect(Math.abs(error() - before)).toBeLessThan(0.5)
  })

  it('still follows the clock when it really moved', () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 30_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    dev.shift(20)
    // Held for MOVED_MS (a glitch looks the same at first), then taken whole - the gap unchanged.
    run(tb, dev, 12_000)
    expect(Math.abs(error() - before)).toBeLessThan(0.5)
  })

  it("doesn't start over for one pair far off (the Fire's at a Stop)", () => {
    const dev = fakeFire()
    const tb = new TimeBase(dev.perf)
    run(tb, dev, 30_000)
    const error = () => (tb.now(dev.ctx)! - dev.truth()) * 1000
    const before = error()
    const at = Math.floor(dev.perf() / 60) * 60 + 60
    dev.setGlitch((stamp) => (stamp === at ? -251 : 0))
    let worst = 0
    for (let t = 0; t < 5_000; t += 50) {
      run(tb, dev, 50)
      expect(tb.now(dev.ctx)).not.toBeNull()
      worst = Math.max(worst, Math.abs(error() - before))
    }
    expect(worst).toBeLessThan(0.5)
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

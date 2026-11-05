import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetClockSyncForTests, estimateFromWindow, getServerTime, sampleClock, syncClock } from './clockSync'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  __resetClockSyncForTests()
})

/** A tablet whose clock runs `ppm` against the server's, on a WLAN with 12-ms best round trips, a
 * noisy tail and now and then a one-sided delay (the path asymmetry that moved bursts). */
function fakeNetwork(opts: { ppm: number; offsetMs: number; seed?: number }) {
  let local = 1_000_000
  let rnd = opts.seed ?? 1
  const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647)
  const server = (t: number) => t + opts.offsetMs + (t - 1_000_000) * opts.ppm * 1e-6
  vi.spyOn(Date, 'now').mockImplementation(() => local)
  vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const up = 6 + random() * (random() < 0.3 ? 80 : 4)
      const down = 6 + random() * (random() < 0.3 ? 80 : 4)
      local += up
      const serverTime = server(local)
      local += down
      return { ok: true, json: async () => ({ serverTime }) }
    }),
  )
  return {
    advance: (ms: number) => (local += ms),
    local: () => local,
    trueOffset: () => server(local) - local,
  }
}

describe('continuous clock sync (docs/29 §5.6, step 4)', () => {
  it('estimates offset and drift from the fastest samples of the last two minutes', () => {
    const now = 200_000
    const samples = Array.from({ length: 60 }, (_, i) => {
      const at = now - 118_000 + i * 2_000
      const asym = i % 4 === 0 ? 20 : 0 // a quarter of the samples one-sidedly late
      return { at, rtt: 12 + (i % 7) * 3 + asym * 2, offset: 500 + (at - now) * 40e-6 + asym }
    })
    const est = estimateFromWindow(samples, now)!
    expect(Math.abs(est.offsetMs - 500)).toBeLessThan(1)
    expect(est.perMs * 1e6).toBeCloseTo(40, 0)
  })

  it('keeps band time within 2 ms of the server on a noisy WLAN, with 50 ppm drift, over ten minutes', async () => {
    const net = fakeNetwork({ ppm: 50, offsetMs: 7_000 })
    await syncClock()
    const errors: number[] = []
    for (let i = 0; i < 300; i++) {
      net.advance(2_000)
      await sampleClock()
      // From 80 s on: the drift line needs 60 s of samples (MIN_SLOPE_SPAN_MS) - until then a 50-ppm
      // clock runs up to 2.5 ms off, the price for never taking a line through a handful of samples.
      if (i > 40) errors.push(getServerTime() - (net.local() + net.trueOffset()))
    }
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(2)
  })

  it('moves band time at most 2 ms per second when the estimate moves, and jumps only for big changes', async () => {
    const net = fakeNetwork({ ppm: 0, offsetMs: 1_000 })
    await syncClock()
    for (let i = 0; i < 60; i++) {
      net.advance(2_000)
      await sampleClock()
    }
    // The server clock is set 10 ms later: band time follows smoothly.
    const before = getServerTime() - net.local()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { net.advance(6); const serverTime = net.local() + 1_010; net.advance(6); return { ok: true, json: async () => ({ serverTime }) } }))
    let last = before
    let maxStep = 0
    for (let i = 0; i < 120; i++) {
      net.advance(2_000)
      await sampleClock()
      const off = getServerTime() - net.local()
      maxStep = Math.max(maxStep, Math.abs(off - last))
      last = off
    }
    expect(maxStep).toBeLessThanOrEqual(4.1) // 2 ms/s over a 2-s sample interval
    expect(Math.abs(last - (before + 10))).toBeLessThan(1)
  })

  it('does not tilt the line through a handful of samples 45 s after the start (Redmi, 2026-11-05)', () => {
    // 45 s of samples whose fastest ones happen to fall early-low and late-high: a line through them
    // ran 2.7 ms/s and pulled band time 33 ms away within ten seconds.
    const now = 145_000
    const samples = Array.from({ length: 30 }, (_, i) => {
      const at = now - 45_000 + i * 1_500
      const fast = i % 3 === 0
      return { at, rtt: fast ? 10 : 30, offset: 400 + (fast ? (i < 15 ? -15 : 15) : 0) }
    })
    const est = estimateFromWindow(samples, now)!
    expect(est.perMs).toBe(0)
    expect(Math.abs(est.offsetMs - 400)).toBeLessThanOrEqual(15)
  })

  it('never takes a drift steeper than a real crystal (100 ppm)', () => {
    const now = 300_000
    const samples = Array.from({ length: 60 }, (_, i) => {
      const at = now - 118_000 + i * 2_000
      return { at, rtt: 12 + (i % 4), offset: 500 + (at - now) * 2e-3 }
    })
    const est = estimateFromWindow(samples, now)!
    expect(est.perMs * 1e6).toBeCloseTo(100, 5)
  })

  it('keeps band time on a single far estimate and follows a far one only once it repeats', async () => {
    const net = fakeNetwork({ ppm: 0, offsetMs: 1_000 })
    await syncClock()
    for (let i = 0; i < 60; i++) {
      net.advance(2_000)
      await sampleClock()
    }
    const before = getServerTime() - net.local()
    // The server's clock is set half a second later (a Stage-Server restart with a corrected clock).
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { net.advance(6); const serverTime = net.local() + 1_500; net.advance(6); return { ok: true, json: async () => ({ serverTime }) } }))
    // Band time moves smoothly (≤ 2 ms/s) while the estimate is near; a step bigger than that is a jump.
    let firstJump: number | null = null
    let last = before
    for (let i = 0; i < 120; i++) {
      net.advance(2_000)
      await sampleClock()
      const off = getServerTime() - net.local()
      if (firstJump === null && Math.abs(off - last) > 10) firstJump = i
      last = off
    }
    expect(firstJump).not.toBeNull()
    expect(firstJump!).toBeGreaterThanOrEqual(4)
    expect(Math.abs(getServerTime() - net.local() - (before + 500))).toBeLessThan(2)
  })

  it('is within 3 ms after the fast samples of the first seconds', async () => {
    const net = fakeNetwork({ ppm: 30, offsetMs: 2_000, seed: 7 })
    await syncClock()
    for (let i = 0; i < 20; i++) {
      net.advance(500)
      await sampleClock()
    }
    expect(Math.abs(getServerTime() - (net.local() + net.trueOffset()))).toBeLessThan(3)
  })

  it('ignores slow samples while audio downloads clog the connection (Redmi after an app start, 2026-11-05)', () => {
    // 75 s after the start: most round trips 300-3000 ms and far off, every fifth one fast and right.
    const now = 175_000
    const samples = Array.from({ length: 38 }, (_, i) => {
      const at = now - 75_000 + i * 2_000
      const fast = i % 5 === 0
      const rtt = fast ? 20 + (i % 3) * 5 : 300 + ((i * 137) % 2700)
      return { at, rtt, offset: 400 + (fast ? 0 : (i % 2 ? -1 : 1) * rtt * 0.4) }
    })
    const est = estimateFromWindow(samples, now)!
    expect(Math.abs(est.offsetMs - 400)).toBeLessThan(2)
  })
})

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
      if (i > 30) errors.push(getServerTime() - (net.local() + net.trueOffset()))
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
})

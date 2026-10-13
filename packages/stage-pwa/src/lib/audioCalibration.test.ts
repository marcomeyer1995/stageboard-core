import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serverTime = vi.hoisted(() => ({ now: 10_000 }))
const clicks = vi.hoisted(() => [] as number[])
vi.mock('./clockSync', () => ({ getServerTime: () => serverTime.now }))
vi.mock('./stageServer', () => ({ getStageServerUrl: () => 'https://server' }))
vi.mock('./deviceId', () => ({ getDeviceId: () => 'fire' }))
vi.mock('./sharedAudioContext', () => ({
  // currentTime follows server time 1:1 here, so audio times read directly as server seconds.
  getSharedAudioContext: () => ({ get currentTime() { return serverTime.now / 1000 }, resume: () => Promise.resolve() }),
  holdAudioOutputAwake: vi.fn(),
}))
vi.mock('./audioClock', () => ({ createAudioClock: () => ({ now: (ctx: { currentTime: number }) => ctx.currentTime, reset: () => {} }) }))
vi.mock('./clickEngine', () => ({ playClickAt: (_ctx: unknown, time: number) => clicks.push(Math.round(time * 1000)) }))

const { runAudioCalibration } = await import('./audioCalibration')

describe('audio calibration on the device (#491)', () => {
  const times = [11_500, 12_200, 13_400]
  beforeEach(() => {
    vi.useFakeTimers()
    clicks.length = 0
    serverTime.now = 10_000
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'r1', times, recordUntil: 15_400 }))
        return new Response(JSON.stringify({ state: 'done', onsets: 3, result: { latencyMs: 433, jitterMs: 4, matched: 3, total: 3, runnerUp: 0, reliable: true } }))
      }),
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function runFor(earlierByMs: number) {
    const done = runAudioCalibration(earlierByMs)
    for (let t = 0; t < 120; t++) {
      serverTime.now += 50
      await vi.advanceTimersByTimeAsync(50)
    }
    return done
  }

  it("plays the real click exactly at the server's irregular times and returns what the server heard", async () => {
    const outcome = await runFor(0)
    expect(clicks).toEqual(times)
    expect(outcome).toMatchObject({ ok: true, status: { state: 'done', result: { latencyMs: 433 } } })
  })

  it('"Prüfen" plays every click the stored latency earlier', async () => {
    await runFor(433)
    expect(clicks).toEqual(times.map((t) => t - 433))
  })

  it('reports a busy server instead of playing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Gerade läuft schon eine Messung' }), { status: 409 })))
    expect(await runAudioCalibration()).toEqual({ ok: false, message: 'Gerade läuft schon eine Messung' })
    expect(clicks).toEqual([])
  })
})

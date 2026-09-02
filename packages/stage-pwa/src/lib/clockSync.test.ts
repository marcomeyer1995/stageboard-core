import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClockSyncStore } from '../store/useClockSyncStore'
import { __resetClockSyncForTests, getServerTime, syncClock } from './clockSync'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __resetClockSyncForTests()
})

describe('syncClock / getServerTime', () => {
  it('computes the offset from a single round trip (server time minus the RTT midpoint)', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        now = 50 // 50ms round trip
        return { ok: true, json: async () => ({ serverTime: 1_000_000 }) }
      }),
    )

    const offset = await syncClock(1)
    // t0=0, t1=50, midpoint=25, offset = serverTime - midpoint = 1_000_000 - 25
    expect(offset).toBe(999_975)
    expect(getServerTime()).toBe(now + offset)

    const state = useClockSyncStore.getState()
    expect(state.offsetMs).toBe(999_975)
    expect(state.rttMs).toBe(50)
    expect(state.jitterMs).toBe(0) // single sample, no spread to measure
    expect(state.driftMs).toBeNull() // only one sync so far, nothing to compare against yet
    expect(state.lastSyncedAt).not.toBeNull()
  })

  it('picks the lowest-RTT sample from a burst, ignoring noisier ones, and records the jitter', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Three samples with RTTs 200ms/20ms/150ms and offsets 9000/1000/500 - only the
    // middle (lowest-RTT) sample's offset should win, but jitter reflects the full spread.
    const rtts = [200, 20, 150]
    const offsets = [9000, 1000, 500]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const i = call++
        const t0 = now
        now += rtts[i]
        const serverTime = (t0 + now) / 2 + offsets[i]
        return { ok: true, json: async () => ({ serverTime }) }
      }),
    )

    const offset = await syncClock(3)
    expect(offset).toBeCloseTo(1000, 6)

    const state = useClockSyncStore.getState()
    expect(state.rttMs).toBe(20)
    expect(state.jitterMs).toBe(200 - 20) // spread between slowest and fastest sample
  })

  it('corrects for a systematically asymmetric path via linear extrapolation, not just the min-RTT sample (#31 second follow-up)', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Real burst captured live from a tablet with an asymmetric WiFi path (#31 second
    // follow-up): offset correlates almost perfectly with RTT (fit intercept ~43.4ms,
    // R² > 0.99) - even the fastest sample (rtt=73) still carries most of its own RTT as
    // bias, so picking it directly (today's old behavior) would have returned ~83.5ms.
    const rtts = [126, 490, 211, 442, 172, 465, 73]
    const offsets = [99, 292, 150.5, 264, 134, 276.5, 83.5]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const i = call++
        const t0 = now
        now += rtts[i]
        const serverTime = (t0 + now) / 2 + offsets[i]
        return { ok: true, json: async () => ({ serverTime }) }
      }),
    )

    const offset = await syncClock(7)

    // Extrapolated intercept, not the min-RTT (rtt=73) sample's raw 83.5ms offset.
    expect(offset).toBeCloseTo(43.4, 0)
    expect(useClockSyncStore.getState().rttMs).toBe(73) // still reports the fastest sample's RTT
  })

  it('falls back to the min-RTT sample when the burst has too few samples to fit a line', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Only 2 samples - a line through 2 points always "fits perfectly" (R²=1), which would
    // be a meaningless, noise-amplifying extrapolation with this little data.
    const rtts = [200, 20]
    const offsets = [900, 100]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const i = call++
        const t0 = now
        now += rtts[i]
        const serverTime = (t0 + now) / 2 + offsets[i]
        return { ok: true, json: async () => ({ serverTime }) }
      }),
    )

    const offset = await syncClock(2)
    expect(offset).toBe(100) // the lower-RTT sample's own offset, not an extrapolated line
  })

  it('falls back to the min-RTT sample when the burst\'s RTT spread is too tight to extrapolate from', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // 3 samples, but RTTs only span 4ms (well under the 10ms floor) - offsets drift by 6ms
    // across them, which if extrapolated as a "trend" would wildly overstate a tiny wobble
    // on an already-tight, low-jitter path.
    const rtts = [10, 12, 14]
    const offsets = [5, 8, 11]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const i = call++
        const t0 = now
        now += rtts[i]
        const serverTime = (t0 + now) / 2 + offsets[i]
        return { ok: true, json: async () => ({ serverTime }) }
      }),
    )

    const offset = await syncClock(3)
    expect(offset).toBe(5) // the lowest-RTT (rtt=10) sample's own offset
  })

  it('derives driftMs from the spread across recent bursts\' offsets, not from jitterMs (#31 follow-up)', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Each burst is a single sample landing on a fixed offset - a noisy RTT (rtts vary a lot)
    // but a stable underlying offset, mirroring what was observed live on real devices: the
    // per-burst jitter can be huge while the actually-synced offset barely moves.
    async function syncWithOffset(offset: number, rtt: number) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => {
          const t0 = now
          now += rtt
          return { ok: true, json: async () => ({ serverTime: (t0 + now) / 2 + offset }) }
        }),
      )
      await syncClock(1)
    }

    await syncWithOffset(100, 10)
    expect(useClockSyncStore.getState().driftMs).toBeNull() // first sync, nothing to compare yet

    await syncWithOffset(103, 400) // huge RTT/jitter, but the offset barely moved
    expect(useClockSyncStore.getState().driftMs).toBeCloseTo(3, 6) // spread across [100, 103]

    await syncWithOffset(90, 15)
    expect(useClockSyncStore.getState().driftMs).toBeCloseTo(13, 6) // spread across [100, 103, 90]
  })

  it('caps the drift window at the last 5 bursts, so an old outlier eventually rolls off', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')

    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    async function syncWithOffset(offset: number) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async () => {
          const t0 = now
          now += 10
          return { ok: true, json: async () => ({ serverTime: (t0 + now) / 2 + offset }) }
        }),
      )
      await syncClock(1)
    }

    await syncWithOffset(0) // this one outlier should roll off the 5-sync window below
    await syncWithOffset(1000)
    await syncWithOffset(1001)
    await syncWithOffset(1002)
    await syncWithOffset(1003)
    expect(useClockSyncStore.getState().driftMs).toBeCloseTo(1003, 6) // window still includes offset 0

    await syncWithOffset(1004)
    expect(useClockSyncStore.getState().driftMs).toBeCloseTo(4, 6) // offset 0 has rolled out of the window
  })

  it('does nothing and keeps the previous sync state when no Stage-Server is configured', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const offset = await syncClock()
    expect(offset).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useClockSyncStore.getState().lastSyncedAt).toBeNull()
  })

  it('keeps offset 0 and no sync timestamp when every sample in the burst fails', async () => {
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const offset = await syncClock(3)
    expect(offset).toBe(0)
    expect(useClockSyncStore.getState().lastSyncedAt).toBeNull()
  })

  it('getServerTime falls back to plain local time before any sync', () => {
    vi.spyOn(Date, 'now').mockReturnValue(42)
    expect(getServerTime()).toBe(42)
  })
})

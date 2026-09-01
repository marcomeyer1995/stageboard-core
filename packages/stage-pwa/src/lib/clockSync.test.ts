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

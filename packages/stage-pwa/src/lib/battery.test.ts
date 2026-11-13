import { afterEach, describe, expect, it, vi } from 'vitest'
import { batteryState } from './battery'

describe('batteryState', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads level and charging', async () => {
    vi.stubGlobal('navigator', { getBattery: () => Promise.resolve({ level: 0.424, charging: false }) })
    expect(await batteryState()).toEqual({ pct: 42, charging: false })
  })

  it('is null where the platform does not tell, or refuses', async () => {
    vi.stubGlobal('navigator', {})
    expect(await batteryState()).toBeNull()
    vi.stubGlobal('navigator', { getBattery: () => Promise.reject(new Error('no')) })
    expect(await batteryState()).toBeNull()
  })
})

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = vi.hoisted(() => ({ acquire: vi.fn().mockResolvedValue({ held: true, lowLatency: true }), release: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => plugin }))
const native = vi.hoisted(() => ({ on: true }))
vi.mock('./native', () => ({ isNativeApp: () => native.on }))
vi.mock('../store/useAppModeStore', async () => {
  const { create } = await import('zustand')
  return { useAppModeStore: create(() => ({ mode: 'gig' as 'gig' | 'practice' })) }
})

const { useAppModeStore } = await import('../store/useAppModeStore')
const { useGigWifiLock, WIFI_LOCK_OFF_KEY } = await import('./useGigWifiLock')

beforeEach(() => {
  plugin.acquire.mockClear()
  plugin.release.mockClear()
  native.on = true
  localStorage.removeItem(WIFI_LOCK_OFF_KEY)
  useAppModeStore.setState({ mode: 'gig' })
})

describe('useGigWifiLock (2026-11-08)', () => {
  it('holds the lock while a Gig is open, lets go for Solo practice', () => {
    renderHook(() => useGigWifiLock())
    expect(plugin.acquire).toHaveBeenCalledTimes(1)
    act(() => useAppModeStore.setState({ mode: 'practice' }))
    expect(plugin.release).toHaveBeenCalled()
    expect(plugin.acquire).toHaveBeenCalledTimes(1)
  })

  it('not in a browser, and not when switched off on this device for a comparison', () => {
    native.on = false
    renderHook(() => useGigWifiLock())
    expect(plugin.acquire).not.toHaveBeenCalled()
    native.on = true
    localStorage.setItem(WIFI_LOCK_OFF_KEY, '1')
    renderHook(() => useGigWifiLock())
    expect(plugin.acquire).not.toHaveBeenCalled()
  })

  it('a lock left over from before a page reload is let go when it is not wanted', () => {
    useAppModeStore.setState({ mode: 'practice' })
    renderHook(() => useGigWifiLock())
    expect(plugin.release).toHaveBeenCalledTimes(1)
    expect(plugin.acquire).not.toHaveBeenCalled()
  })
})

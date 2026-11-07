import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginHealth, PluginInstallation } from 'shared-types'

/** Band time: the Fire's own clock ran 14 s ahead of it (2026-11-06). */
const SERVER_NOW = 1_793_977_590_000
const DEVICE_AHEAD_MS = 14_000

vi.mock('./clockSync', () => ({ getServerTime: () => SERVER_NOW }))
vi.mock('./useMidiTrigger', () => ({ useMidiTrigger: () => ({ status: 'disconnected' }) }))
vi.mock('./reportClientHealth', () => ({ reportClientHealth: async () => {} }))
vi.mock('../store/useWorkspaceStore', () => ({ useWorkspaceStore: (select: (state: { activeWorkspaceId: string }) => unknown) => select({ activeWorkspaceId: 'band-a' }) }))
vi.mock('../store/usePluginsStore', async () => {
  const { create } = await import('zustand')
  return { usePluginsStore: create(() => ({ installed: [] as PluginInstallation[], health: { plugins: {} } as PluginHealth })) }
})

const { usePluginsStore } = await import('../store/usePluginsStore')
const { useCapabilities } = await import('./useCapabilities')

const MIXER: PluginInstallation = {
  id: 'mock-mixer',
  name: 'Mock Mixer',
  version: '0.0.1',
  runtime: 'server',
  capabilities: ['mixer'],
  transports: [],
  hardwareIds: [],
  enabled: true,
  installedAt: 0,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useCapabilities', () => {
  it('judges a heartbeat in band time - a device clock 14 s fast does not make it stale', () => {
    vi.useFakeTimers({ now: SERVER_NOW + DEVICE_AHEAD_MS, toFake: ['Date'] })
    // Stamped by the Stage-Server 2 s ago - on the device's own clock it looks 16 s old.
    usePluginsStore.setState({ installed: [MIXER], health: { plugins: { 'mock-mixer': { status: 'online', lastSeenAt: SERVER_NOW - 2000 } } } })

    const { result } = renderHook(() => useCapabilities())

    expect(result.current.get('mixer')).toBe('available')
  })

  it('still degrades a heartbeat that really is older than the timeout', () => {
    usePluginsStore.setState({ installed: [MIXER], health: { plugins: { 'mock-mixer': { status: 'online', lastSeenAt: SERVER_NOW - 16_000 } } } })

    const { result } = renderHook(() => useCapabilities())

    expect(result.current.get('mixer')).toBe('degraded')
  })
})

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BandHostEntry } from 'shared-types'
import { useBandSettingsStore } from '../store/useBandSettingsStore'
import { useStageServerStore } from '../store/useStageServerStore'
import { useHostEpochStore } from './hostEpoch'

vi.mock('../store/useBandSettingsStore', async () => {
  const { create } = await import('zustand')
  return { useBandSettingsStore: create(() => ({ settings: { id: 'band' } })) }
})

const native = vi.hoisted(() => ({ value: false }))
vi.mock('./native', async (importOriginal) => ({ ...(await importOriginal<typeof import('./native')>()), isNativeApp: () => native.value }))

const { useHostFollower } = await import('./useHostFollower')

const primary: BandHostEntry = { hostId: 'laptop', url: 'https://10.0.0.1:8443', priority: 1 }
const backup: BandHostEntry = { hostId: 'stage-pc', url: 'https://10.0.0.2:8443', priority: 2 }

/** `/time` of each host announces the epoch given for its address. */
function stubEpochs(byUrl: Record<string, number>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const base = url.replace('/time', '')
    return base in byUrl ? { ok: true, json: async () => ({ serverTime: 1, hostId: 'x', epoch: byUrl[base] }) } : { ok: false, json: async () => ({}) }
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  native.value = false
  useStageServerStore.setState({ url: primary.url })
  useBandSettingsStore.setState({ settings: { id: 'band', hosts: [primary, backup] } })
  useHostEpochStore.setState({ highestEpoch: 1, currentEpoch: 1, staleHost: false })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useHostFollower (#916)', () => {
  it('moves the paired server to the other host once it announces a higher epoch', async () => {
    stubEpochs({ [backup.url]: 2 })
    renderHook(() => useHostFollower())
    await vi.advanceTimersByTimeAsync(5_100)
    expect(useStageServerStore.getState().url).toBe(backup.url)
  })

  it('stays while the other host announces the same epoch', async () => {
    stubEpochs({ [backup.url]: 1 })
    renderHook(() => useHostFollower())
    await vi.advanceTimersByTimeAsync(11_000)
    expect(useStageServerStore.getState().url).toBe(primary.url)
  })

  it('does nothing in the native app (certificate pinning is not taught the list yet)', async () => {
    native.value = true
    stubEpochs({ [backup.url]: 2 })
    renderHook(() => useHostFollower())
    await vi.advanceTimersByTimeAsync(11_000)
    expect(useStageServerStore.getState().url).toBe(primary.url)
  })

  it('stops asking when it is unmounted', async () => {
    stubEpochs({ [backup.url]: 2 })
    const { unmount } = renderHook(() => useHostFollower())
    unmount()
    await vi.advanceTimersByTimeAsync(11_000)
    expect(useStageServerStore.getState().url).toBe(primary.url)
  })
})

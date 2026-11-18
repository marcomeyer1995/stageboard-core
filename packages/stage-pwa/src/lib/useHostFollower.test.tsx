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
const shell = vi.hoisted(() => ({ pinListedHosts: vi.fn(async () => ({ pin: [], conflicts: [] as string[] })), pairWithServer: vi.fn(async () => {}) }))
vi.mock('./native', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./native')>()),
  isNativeApp: () => native.value,
  pinListedHosts: shell.pinListedHosts,
  pairWithServer: shell.pairWithServer,
}))

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

  describe('in the native app (#916)', () => {
    const FP = 'c'.repeat(64)
    const backupPinned: BandHostEntry = { ...backup, certFingerprint: FP }

    beforeEach(() => {
      native.value = true
      shell.pinListedHosts.mockClear()
      shell.pairWithServer.mockClear()
      useBandSettingsStore.setState({ settings: { id: 'band', hosts: [primary, backupPinned] } })
    })

    it('pins the listed hosts so the other one can be asked, and does so before asking', async () => {
      stubEpochs({ [backup.url]: 1 })
      renderHook(() => useHostFollower())
      await vi.advanceTimersByTimeAsync(5_100)
      expect(shell.pinListedHosts).toHaveBeenCalledWith([primary, backupPinned])
    })

    it('moves to the other host through the shell (pins and pairs) once it announces a higher epoch', async () => {
      stubEpochs({ [backup.url]: 2 })
      renderHook(() => useHostFollower())
      await vi.advanceTimersByTimeAsync(5_100)
      expect(shell.pairWithServer).toHaveBeenCalledWith('10.0.0.2:8443', FP)
    })

    it('does not move to a host it has no fingerprint for - it could not trust it', async () => {
      useBandSettingsStore.setState({ settings: { id: 'band', hosts: [primary, backup] } })
      stubEpochs({ [backup.url]: 2 })
      renderHook(() => useHostFollower())
      await vi.advanceTimersByTimeAsync(11_000)
      expect(shell.pairWithServer).not.toHaveBeenCalled()
    })

    it('stays on equal epochs, as in the browser', async () => {
      stubEpochs({ [backup.url]: 1 })
      renderHook(() => useHostFollower())
      await vi.advanceTimersByTimeAsync(11_000)
      expect(shell.pairWithServer).not.toHaveBeenCalled()
    })
  })

  it('stops asking when it is unmounted', async () => {
    stubEpochs({ [backup.url]: 2 })
    const { unmount } = renderHook(() => useHostFollower())
    unmount()
    await vi.advanceTimersByTimeAsync(11_000)
    expect(useStageServerStore.getState().url).toBe(primary.url)
  })
})

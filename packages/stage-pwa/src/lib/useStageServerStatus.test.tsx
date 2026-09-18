import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useStageServerStatus, STATUS_SLOW_AFTER_MS } = await import('./useStageServerStatus')

const bands = [
  { workspaceId: 'band-a', workspaceName: 'Abadschendaler' },
  { workspaceId: 'band-b', workspaceName: 'SOAT' },
]
const info = { lanIp: '192.168.1.50', hostname: 'stageboard.local' }

/** A promise the test resolves by hand, to control which request answers when. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function stub(overrides: Partial<Parameters<typeof useWorkspaceStore.setState>[0]> = {}) {
  useWorkspaceStore.setState({
    listWorkspaces: vi.fn().mockResolvedValue(bands),
    fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' }),
    fetchServerInfo: vi.fn().mockResolvedValue(info),
    ...overrides,
  })
}

beforeEach(() => stub())
afterEach(() => vi.useRealTimers())

describe('useStageServerStatus', () => {
  it('starts as loading, then reports everything once answered', async () => {
    const { result } = renderHook(() => useStageServerStatus())
    expect(result.current.status).toBe('loading')

    await waitFor(() => expect(result.current.status).toBe('reachable'))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(result.current).toMatchObject({
      lanIp: '192.168.1.50',
      hostname: 'stageboard.local',
      activeWorkspaceId: 'band-a',
      activeWorkspaceName: 'Abadschendaler',
    })
    expect(result.current.workspaces).toEqual(bands)
  })

  it('shows each answer as it arrives instead of waiting for the slowest request', async () => {
    const slowList = deferred<typeof bands>()
    stub({ listWorkspaces: vi.fn().mockReturnValue(slowList.promise) })

    const { result } = renderHook(() => useStageServerStatus())

    // The two quick requests are in; the list is still pending - and the screen already has data.
    await waitFor(() => expect(result.current.status).toBe('reachable'))
    expect(result.current.activeWorkspaceId).toBe('band-a')
    expect(result.current.lanIp).toBe('192.168.1.50')
    expect(result.current.workspaces).toBeNull()
    expect(result.current.refreshing).toBe(true)

    await act(async () => slowList.resolve(bands))
    await waitFor(() => expect(result.current.activeWorkspaceName).toBe('Abadschendaler'))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
  })

  it('is unreachable as soon as all three have answered with nothing - without waiting for the timeout', async () => {
    stub({
      listWorkspaces: vi.fn().mockResolvedValue(null),
      fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue(null),
      fetchServerInfo: vi.fn().mockResolvedValue(null),
    })

    const { result } = renderHook(() => useStageServerStatus())

    await waitFor(() => expect(result.current.status).toBe('unreachable'))
    expect(result.current.refreshing).toBe(false)
  })

  it('a reachable server with nothing activated is reachable, with no active band', async () => {
    stub({ fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: null }) })

    const { result } = renderHook(() => useStageServerStatus())

    await waitFor(() => expect(result.current.status).toBe('reachable'))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(result.current.activeWorkspaceId).toBeNull()
    expect(result.current.activeWorkspaceName).toBeNull()
  })

  it('found live (30s of "Lade…", answers stuck behind audio downloads): with no answer after the delay it is flagged slow - NOT unreachable - and a late answer still wins', async () => {
    vi.useFakeTimers()
    const never = () => new Promise<never>(() => {})
    const lateActive = deferred<{ activeWorkspaceId: string | null }>()
    stub({
      listWorkspaces: vi.fn().mockImplementation(never),
      fetchActiveWorkspaceHardware: vi.fn().mockReturnValue(lateActive.promise),
      fetchServerInfo: vi.fn().mockImplementation(never),
    })

    const { result } = renderHook(() => useStageServerStatus())
    expect(result.current.slow).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_SLOW_AFTER_MS - 100)
    })
    expect(result.current.slow).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    // Late is not failed: still loading, just flagged - never "unreachable" while it may yet answer.
    expect(result.current.slow).toBe(true)
    expect(result.current.status).toBe('loading')

    await act(async () => lateActive.resolve({ activeWorkspaceId: 'band-b' }))
    expect(result.current.status).toBe('reachable')
    expect(result.current.slow).toBe(false)
    expect(result.current.activeWorkspaceId).toBe('band-b')
  })

  it('with a last known status on screen, a slow refresh keeps showing it (flagged slow) instead of blanking it', async () => {
    const first = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(first.result.current.refreshing).toBe(false))
    first.unmount()

    vi.useFakeTimers()
    const hang = () => new Promise<never>(() => {})
    stub({
      listWorkspaces: vi.fn().mockImplementation(hang),
      fetchActiveWorkspaceHardware: vi.fn().mockImplementation(hang),
      fetchServerInfo: vi.fn().mockImplementation(hang),
    })
    const second = renderHook(() => useStageServerStatus())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_SLOW_AFTER_MS + 100)
    })

    expect(second.result.current.slow).toBe(true)
    expect(second.result.current.status).toBe('reachable')
    expect(second.result.current.activeWorkspaceName).toBe('Abadschendaler')
  })

  it('a second screen shows the last known status instantly, marked as refreshing, while re-checking', async () => {
    const first = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(first.result.current.refreshing).toBe(false))
    expect(first.result.current.status).toBe('reachable')
    first.unmount()

    // The next open: every request hangs - it must still have the previous answer on screen.
    const hang = () => new Promise<never>(() => {})
    stub({
      listWorkspaces: vi.fn().mockImplementation(hang),
      fetchActiveWorkspaceHardware: vi.fn().mockImplementation(hang),
      fetchServerInfo: vi.fn().mockImplementation(hang),
    })
    const second = renderHook(() => useStageServerStatus())

    expect(second.result.current.status).toBe('reachable')
    expect(second.result.current.activeWorkspaceName).toBe('Abadschendaler')
    expect(second.result.current.hostname).toBe('stageboard.local')
    await waitFor(() => expect(second.result.current.refreshing).toBe(true))
  })

  it('a request that fails doesn\'t wipe what was already known from the others', async () => {
    const first = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(first.result.current.refreshing).toBe(false))
    first.unmount()

    stub({ fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue(null) })
    const second = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(second.result.current.refreshing).toBe(false))

    expect(second.result.current.status).toBe('reachable')
    expect(second.result.current.activeWorkspaceId).toBe('band-a')
  })

  it('once the server is found unreachable, the last known status is dropped - never shown as current again', async () => {
    const first = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(first.result.current.refreshing).toBe(false))
    first.unmount()

    stub({
      listWorkspaces: vi.fn().mockResolvedValue(null),
      fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue(null),
      fetchServerInfo: vi.fn().mockResolvedValue(null),
    })
    const second = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(second.result.current.status).toBe('unreachable'))
    second.unmount()

    stub()
    const third = renderHook(() => useStageServerStatus())
    expect(third.result.current.status).toBe('loading')
    expect(third.result.current.workspaces).toBeNull()
  })

  it('reload() resolves only once all three requests have settled', async () => {
    const slowInfo = deferred<typeof info>()
    stub({ fetchServerInfo: vi.fn().mockReturnValue(slowInfo.promise) })
    const { result } = renderHook(() => useStageServerStatus())
    await waitFor(() => expect(result.current.status).toBe('reachable'))

    let settled = false
    const reloading = result.current.reload().then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)

    slowInfo.resolve(info)
    await act(async () => {
      await reloading
    })
    expect(settled).toBe(true)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { useShowStateStore } from './useShowStateStore'
import { getShowState, putShowState } from '../lib/showStateDb'

vi.mock('../lib/deviceId', () => ({ getDeviceId: () => 'me' }))
vi.mock('../lib/showStateDb', () => ({
  getShowState: vi.fn(),
  putShowState: vi.fn(),
  showStateChanges: vi.fn(),
  switchShowStateWorkspace: vi.fn(),
}))

function setState(state: Partial<ShowState>, isMaster: boolean) {
  useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, ...state }, isMaster, holdsToken: isMaster, selfCheck: 'ok', deviceId: 'me' })
}

describe('releaseMaster', () => {
  beforeEach(() => {
    vi.mocked(putShowState).mockReset().mockResolvedValue(undefined)
    vi.mocked(getShowState).mockReset()
  })

  it('leaves the token vacant and drops the local master flag', async () => {
    setState({ masterHolderId: 'me', masterClaimedAt: 5 }, true)
    vi.mocked(getShowState).mockResolvedValue({ ...DEFAULT_SHOW_STATE, masterHolderId: null, masterClaimedAt: null })

    await useShowStateStore.getState().releaseMaster()

    expect(putShowState).toHaveBeenCalledWith({ masterHolderId: null, masterClaimedAt: null })
    expect(useShowStateStore.getState().isMaster).toBe(false)
    expect(useShowStateStore.getState().state.masterHolderId).toBeNull()
  })

  it('does nothing on a device that is not the master', async () => {
    setState({ masterHolderId: 'other' }, false)

    await useShowStateStore.getState().releaseMaster()

    expect(putShowState).not.toHaveBeenCalled()
  })
})

describe('applyPatch (2026-09-27)', () => {
  beforeEach(() => {
    vi.mocked(putShowState).mockReset()
  })

  it('applies the patch to this device at once, before the database write returns', () => {
    // Waiting for the write to come back through the changes feed delayed Stop by 0.87 s.
    vi.mocked(putShowState).mockReturnValue(new Promise(() => {}))
    setState({ playbackStatus: 'playing', playbackStartedAt: 1000 }, true)

    void useShowStateStore.getState().applyPatch({ playbackStatus: 'stopped', playbackStartedAt: null })

    expect(useShowStateStore.getState().state.playbackStatus).toBe('stopped')
    expect(putShowState).toHaveBeenCalledWith({ playbackStatus: 'stopped', playbackStartedAt: null })
  })

  it('changes nothing on a device that is not the master', () => {
    setState({ playbackStatus: 'playing' }, false)
    void useShowStateStore.getState().applyPatch({ playbackStatus: 'stopped' })
    expect(useShowStateStore.getState().state.playbackStatus).toBe('playing')
    expect(putShowState).not.toHaveBeenCalled()
  })
})

describe('master self-check gating (#378 option B)', () => {
  it('a holder that fails the self-check is not master and cannot write ShowState', async () => {
    vi.mocked(putShowState).mockReset().mockResolvedValue(undefined)
    setState({ masterHolderId: 'me' }, true)
    useShowStateStore.getState().setSelfCheck('unconfirmed')
    expect(useShowStateStore.getState().isMaster).toBe(false)
    expect(useShowStateStore.getState().holdsToken).toBe(true)

    await useShowStateStore.getState().applyPatch({ playbackStatus: 'playing' })
    expect(putShowState).not.toHaveBeenCalled()

    // Confirmed again -> master again.
    useShowStateStore.getState().setSelfCheck('ok')
    expect(useShowStateStore.getState().isMaster).toBe(true)
  })

  it('can still hand the token back while the self-check fails', async () => {
    vi.mocked(putShowState).mockReset().mockResolvedValue(undefined)
    vi.mocked(getShowState).mockResolvedValue({ ...DEFAULT_SHOW_STATE, masterHolderId: null })
    setState({ masterHolderId: 'me' }, true)
    useShowStateStore.getState().setSelfCheck('sync-error')
    await useShowStateStore.getState().releaseMaster()
    expect(putShowState).toHaveBeenCalledWith({ masterHolderId: null, masterClaimedAt: null })
    useShowStateStore.getState().setSelfCheck('ok')
  })
})


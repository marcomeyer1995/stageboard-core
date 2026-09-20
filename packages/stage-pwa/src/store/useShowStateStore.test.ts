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
  useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, ...state }, isMaster, deviceId: 'me' })
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { drivesAutomation, useShowStateStore } from './useShowStateStore'
import { getShowState, putShowState, showStateChanges } from '../lib/showStateDb'
import { pushShowState, reportShowStateArrival, subscribeToShowStatePush } from '../lib/showStatePush'

vi.mock('../lib/deviceId', () => ({ getDeviceId: () => 'me' }))
vi.mock('../lib/showStatePush', () => ({ pushShowState: vi.fn(), reportShowStateArrival: vi.fn(), subscribeToShowStatePush: vi.fn(() => () => {}) }))
vi.mock('../lib/showStateDb', () => ({
  getShowState: vi.fn(),
  putShowState: vi.fn(),
  showStateChanges: vi.fn(),
  switchShowStateWorkspace: vi.fn(),
}))

function setState(state: Partial<ShowState>, isMaster: boolean) {
  useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, ...state }, isMaster, holdsToken: isMaster, selfCheck: 'ok', deviceId: 'me', masterIdentity: 'me' })
}

describe("master identity (#85, 'account' mode)", () => {
  beforeEach(() => {
    vi.mocked(putShowState).mockReset().mockResolvedValue(undefined)
    vi.mocked(getShowState).mockReset()
  })

  it('a device of the person holding the token holds it too, and claiming writes the person', async () => {
    setState({ masterHolderId: 'profile:p1' }, false)
    useShowStateStore.getState().setMasterIdentity('profile:p1')
    expect(useShowStateStore.getState()).toMatchObject({ holdsToken: true, isMaster: true })

    setState({ masterHolderId: null }, false)
    useShowStateStore.getState().setMasterIdentity('profile:p2')
    vi.mocked(getShowState).mockResolvedValue({ ...DEFAULT_SHOW_STATE, masterHolderId: 'profile:p2' })
    await useShowStateStore.getState().claimMaster()
    expect(putShowState).toHaveBeenCalledWith(expect.objectContaining({ masterHolderId: 'profile:p2' }))
    expect(useShowStateStore.getState().holdsToken).toBe(true)
  })
})

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
    expect(putShowState).toHaveBeenCalledWith(expect.objectContaining({ playbackStatus: 'stopped', playbackStartedAt: null }))
  })

  it('changes nothing on a device that is not the master', () => {
    setState({ playbackStatus: 'playing' }, false)
    void useShowStateStore.getState().applyPatch({ playbackStatus: 'stopped' })
    expect(useShowStateStore.getState().state.playbackStatus).toBe('playing')
    expect(putShowState).not.toHaveBeenCalled()
  })
})

describe('drivesAutomation - one driving device in Pro-Person mode (Marco, 2026-10-08)', () => {
  it('the device that last acted as master drives; another master device of the person does not', async () => {
    vi.mocked(putShowState).mockResolvedValue(undefined as never)
    setState({ playbackStatus: 'stopped' }, true)
    const me = useShowStateStore.getState().deviceId
    await useShowStateStore.getState().applyPatch({ playbackStatus: 'playing' })
    expect(putShowState).toHaveBeenLastCalledWith(expect.objectContaining({ drivingDeviceId: me }))
    expect(drivesAutomation(useShowStateStore.getState())).toBe(true)

    // The person's phone acted last - this tablet stays master but stops driving.
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, drivingDeviceId: 'phone' } })
    expect(useShowStateStore.getState().isMaster).toBe(true)
    expect(drivesAutomation(useShowStateStore.getState())).toBe(false)
  })

  it('without a recorded device (older state) every master drives, as before', () => {
    setState({ playbackStatus: 'stopped' }, true)
    useShowStateStore.setState({ state: { ...useShowStateStore.getState().state, drivingDeviceId: undefined } })
    expect(drivesAutomation(useShowStateStore.getState())).toBe(true)
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


describe('fast lane for show-state changes (#468)', () => {
  let onPush: (push: { deviceId: string; issuedAt: number; patch: Partial<ShowState> }) => void = () => {}
  let onDbChange: () => Promise<void> = async () => {}

  beforeEach(async () => {
    vi.mocked(putShowState).mockReset().mockResolvedValue(undefined)
    vi.mocked(pushShowState).mockReset()
    vi.mocked(reportShowStateArrival).mockReset()
    vi.mocked(getShowState).mockReset().mockResolvedValue({ ...DEFAULT_SHOW_STATE, stateIssuedAt: 100 })
    vi.mocked(showStateChanges).mockReturnValue({ on: (_event: string, cb: () => Promise<void>) => (onDbChange = cb), cancel: vi.fn() } as never)
    vi.mocked(subscribeToShowStatePush).mockImplementation((_ws, cb) => {
      onPush = cb as typeof onPush
      return () => {}
    })
    useShowStateStore.setState({ deviceId: 'me', masterIdentity: 'me', selfCheck: 'ok' })
    await useShowStateStore.getState().init('band')
  })

  it('the master pushes every change through the Stage-Server and stamps it, then writes the database', async () => {
    useShowStateStore.setState({ isMaster: true, holdsToken: true })
    await useShowStateStore.getState().applyPatch({ playbackStatus: 'playing' })
    const push = vi.mocked(pushShowState).mock.calls[0]
    expect(push[0]).toBe('band')
    expect(push[1]).toMatchObject({ deviceId: 'me', patch: { playbackStatus: 'playing' } })
    expect(putShowState).toHaveBeenCalledWith(expect.objectContaining({ playbackStatus: 'playing', stateIssuedAt: push[1].issuedAt }))
  })

  it('another device applies a pushed Play at once and reports when it arrived', () => {
    onPush({ deviceId: 'fire', issuedAt: 200, patch: { playbackStatus: 'playing', playbackStartedAt: 600, stateIssuedAt: 200 } })
    expect(useShowStateStore.getState().state.playbackStatus).toBe('playing')
    expect(reportShowStateArrival).toHaveBeenCalledWith('band', expect.objectContaining({ deviceId: 'me', issuedAt: 200, via: 'push' }))
  })

  it('a late replication of an older state does not undo a pushed change; once it catches up it takes over', async () => {
    onPush({ deviceId: 'fire', issuedAt: 200, patch: { playbackStatus: 'playing', stateIssuedAt: 200 } })
    vi.mocked(getShowState).mockResolvedValue({ ...DEFAULT_SHOW_STATE, playbackStatus: 'stopped', stateIssuedAt: 100 })
    await onDbChange()
    expect(useShowStateStore.getState().state.playbackStatus).toBe('playing')
    vi.mocked(getShowState).mockResolvedValue({ ...DEFAULT_SHOW_STATE, playbackStatus: 'paused', stateIssuedAt: 300 })
    await onDbChange()
    expect(useShowStateStore.getState().state.playbackStatus).toBe('paused')
  })

  it('ignores its own pushes and pushes older than what it has', () => {
    onPush({ deviceId: 'me', issuedAt: 500, patch: { playbackStatus: 'playing' } })
    onPush({ deviceId: 'fire', issuedAt: 50, patch: { playbackStatus: 'playing' } })
    expect(useShowStateStore.getState().state.playbackStatus).toBe('stopped')
  })
})

import type { LocalChangesHandle } from '../lib/localChanges'
import { create } from 'zustand'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { randomId } from '../lib/id'
import { getShowState, putShowState, showStateChanges, switchShowStateWorkspace } from '../lib/showStateDb'
import type { MasterSelfCheck } from '../lib/masterTakeover'

interface ShowStateStore {
  state: ShowState
  /** This tablet's stable random id - the same one Presence reporting uses (deviceId.ts), not
   * a second, separately-generated identity: "which device holds the Master-Token" and "which
   * device is currently online" must mean the same device, not two coincidentally-similar
   * ones (found live, 2026-09-04, while scoping the DeviceRegistry slice of #10). */
  deviceId: string
  /** Who holds the token when this device does (#85): the device id in the band's 'device'
   * master mode (default), `profile:<id>` in 'account' mode - then every device of that person
   * is master together. Set by useMasterIdentity. */
  masterIdentity: string
  setMasterIdentity: (identity: string) => void
  /** The replicated token names this device (`state.masterHolderId === masterIdentity`). */
  holdsToken: boolean
  /** Result of the holder's self-check (#378 option B, set by useMasterSelfCheck). */
  selfCheck: MasterSelfCheck
  /** May act as master right now: holds the token AND passes the self-check. Every master-gated
   * write and control checks this. */
  isMaster: boolean
  setSelfCheck: (check: MasterSelfCheck) => void
  init: (workspaceId: string) => Promise<void>
  /** Claims (or re-claims, e.g. "Take Over" after a crashed master) the token for this tablet. */
  claimMaster: () => Promise<void>
  /** Hands the token back on purpose ("Master abgeben") so a planned handover doesn't have to
   * wait out the 15 s heartbeat timeout or need a Force Takeover - leaves it vacant for anyone to
   * claim. No-op for a device that isn't the master. */
  releaseMaster: () => Promise<void>
  /** Opens a fresh Ready Check (#60) for the whole band, or closes the open one. Master-gated: the
   * check is an instruction from whoever runs the show. */
  startReadyCheck: () => Promise<void>
  endReadyCheck: () => Promise<void>
  setActiveSetlist: (setlistId: string | null) => Promise<void>
  /** Master-gated raw ShowState patch - the one write path queue.ts's transport/queue-advance
   * actions go through, so "only the current master ever writes ShowState" (claimMaster's
   * trust model) stays enforced in a single place rather than duplicated per caller. */
  applyPatch: (patch: Partial<ShowState>) => Promise<void>
}

let changesHandle: LocalChangesHandle<ShowState> | null = null

function mastership(holdsToken: boolean, selfCheck: MasterSelfCheck): { holdsToken: boolean; isMaster: boolean } {
  return { holdsToken, isMaster: holdsToken && selfCheck === 'ok' }
}

export const useShowStateStore = create<ShowStateStore>((set, get) => ({
  state: DEFAULT_SHOW_STATE,
  deviceId: getDeviceId(),
  masterIdentity: getDeviceId(),
  holdsToken: false,
  selfCheck: 'ok',
  isMaster: false,
  setMasterIdentity: (identity) => {
    if (identity === get().masterIdentity) return
    set({ masterIdentity: identity, ...mastership(get().state.masterHolderId === identity, get().selfCheck) })
  },
  setSelfCheck: (check) => {
    if (check === get().selfCheck) return
    set({ selfCheck: check, isMaster: get().holdsToken && check === 'ok' })
  },
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchShowStateWorkspace(workspaceId)
    set({ state: DEFAULT_SHOW_STATE, holdsToken: false, isMaster: false })

    const state = await getShowState()
    set({ state, ...mastership(state.masterHolderId === get().masterIdentity, get().selfCheck) })

    changesHandle = showStateChanges()
    changesHandle.on('change', async () => {
      const fresh = await getShowState()
      set({ state: fresh, ...mastership(fresh.masterHolderId === get().masterIdentity, get().selfCheck) })
    })
  },
  claimMaster: async () => {
    const { masterIdentity } = get()
    await putShowState({ masterHolderId: masterIdentity, masterClaimedAt: Date.now(), drivingDeviceId: get().deviceId })
    const fresh = await getShowState()
    set({ state: fresh, ...mastership(fresh.masterHolderId === masterIdentity, get().selfCheck) })
  },
  releaseMaster: async () => {
    const { masterIdentity, holdsToken } = get()
    // Handing back works even while the self-check fails - giving the token up is always safe.
    if (!holdsToken) return
    await putShowState({ masterHolderId: null, masterClaimedAt: null })
    const fresh = await getShowState()
    set({ state: fresh, ...mastership(fresh.masterHolderId === masterIdentity, get().selfCheck) })
  },
  startReadyCheck: async () => {
    if (!get().isMaster) return
    await putShowState({ readyCheckId: randomId() })
  },
  endReadyCheck: async () => {
    if (!get().isMaster) return
    await putShowState({ readyCheckId: null })
  },
  setActiveSetlist: async (setlistId) => {
    if (!get().isMaster) return
    await putShowState({ activeSetlistId: setlistId })
  },
  applyPatch: async (patch) => {
    if (!get().isMaster) return
    // This device's own state first, the database second: waiting for the write to come back
    // through the local changes feed delayed Stop by 0.87 s on the band's tablet (measured
    // 2026-09-27 - the backing track and click kept going after the tap). Every other tablet
    // still learns it through replication; the feed's echo then just re-sets the same values.
    // Whoever acts as master is the one that drives the automatic steps from now on (drivingDeviceId).
    const mine = { ...patch, drivingDeviceId: get().deviceId }
    set({ state: { ...get().state, ...mine } })
    await putShowState(mine)
  },
}))

/**
 * Whether this device runs the master's automatic steps: it is master and either the device that
 * last acted as master or nobody is recorded yet (older state). One device in Pro-Person mode,
 * where all devices of the master are master - otherwise each of them advanced at the track end,
 * measured tracks and logged (Marco, 2026-10-08). If that device goes away, the next master action
 * on another device of the person takes over.
 */
export function drivesAutomation(store: Pick<ShowStateStore, 'isMaster' | 'deviceId' | 'state'>): boolean {
  return store.isMaster && (!store.state.drivingDeviceId || store.state.drivingDeviceId === store.deviceId)
}

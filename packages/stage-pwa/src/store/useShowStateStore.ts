import { create } from 'zustand'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { getDeviceId } from '../lib/deviceId'
import { getShowState, putShowState, showStateChanges, switchShowStateWorkspace } from '../lib/showStateDb'

interface ShowStateStore {
  state: ShowState
  /** This tablet's stable random id - the same one Presence reporting uses (deviceId.ts), not
   * a second, separately-generated identity: "which device holds the Master-Token" and "which
   * device is currently online" must mean the same device, not two coincidentally-similar
   * ones (found live, 2026-09-04, while scoping the DeviceRegistry slice of #10). */
  deviceId: string
  isMaster: boolean
  init: (workspaceId: string) => Promise<void>
  /** Claims (or re-claims, e.g. "Take Over" after a crashed master) the token for this tablet. */
  claimMaster: () => Promise<void>
  setActiveSetlist: (setlistId: string | null) => Promise<void>
  /** Master-gated raw ShowState patch - the one write path queue.ts's transport/queue-advance
   * actions go through, so "only the current master ever writes ShowState" (claimMaster's
   * trust model) stays enforced in a single place rather than duplicated per caller. */
  applyPatch: (patch: Partial<ShowState>) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<ShowState> | null = null

export const useShowStateStore = create<ShowStateStore>((set, get) => ({
  state: DEFAULT_SHOW_STATE,
  deviceId: getDeviceId(),
  isMaster: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchShowStateWorkspace(workspaceId)
    set({ state: DEFAULT_SHOW_STATE, isMaster: false })

    const state = await getShowState()
    set({ state, isMaster: state.masterHolderId === get().deviceId })

    changesHandle = showStateChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', async () => {
      const fresh = await getShowState()
      set({ state: fresh, isMaster: fresh.masterHolderId === get().deviceId })
    })
  },
  claimMaster: async () => {
    const { deviceId } = get()
    await putShowState({ masterHolderId: deviceId, masterClaimedAt: Date.now() })
    const fresh = await getShowState()
    set({ state: fresh, isMaster: fresh.masterHolderId === deviceId })
  },
  setActiveSetlist: async (setlistId) => {
    if (!get().isMaster) return
    await putShowState({ activeSetlistId: setlistId })
  },
  applyPatch: async (patch) => {
    if (!get().isMaster) return
    await putShowState(patch)
  },
}))

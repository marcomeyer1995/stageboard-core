import { create } from 'zustand'
import { randomId } from '../lib/id'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { getShowState, getShowStateDb, putShowState, switchShowStateWorkspace } from '../lib/showStateDb'

const CLIENT_ID_KEY = 'stageboard-client-id'

function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = randomId()
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

interface ShowStateStore {
  state: ShowState
  clientId: string
  isMaster: boolean
  init: (workspaceId: string) => Promise<void>
  /** Claims (or re-claims, e.g. "Take Over" after a crashed master) the token for this tablet. */
  claimMaster: () => Promise<void>
  setActiveEntry: (entryId: string) => Promise<void>
  setActiveSetlist: (setlistId: string | null) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<ShowState> | null = null

export const useShowStateStore = create<ShowStateStore>((set, get) => ({
  state: DEFAULT_SHOW_STATE,
  clientId: getClientId(),
  isMaster: false,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchShowStateWorkspace(workspaceId)
    set({ state: DEFAULT_SHOW_STATE, isMaster: false })

    const state = await getShowState()
    set({ state, isMaster: state.masterHolderId === get().clientId })

    changesHandle = getShowStateDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', async () => {
      const fresh = await getShowState()
      set({ state: fresh, isMaster: fresh.masterHolderId === get().clientId })
    })
  },
  claimMaster: async () => {
    const { clientId } = get()
    await putShowState({ masterHolderId: clientId, masterClaimedAt: Date.now() })
    const fresh = await getShowState()
    set({ state: fresh, isMaster: fresh.masterHolderId === clientId })
  },
  setActiveEntry: async (entryId) => {
    if (!get().isMaster) return
    await putShowState({ activeEntryId: entryId })
  },
  setActiveSetlist: async (setlistId) => {
    if (!get().isMaster) return
    await putShowState({ activeSetlistId: setlistId })
  },
}))

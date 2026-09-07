import { create } from 'zustand'
import { EMPTY_DISCOVERY_SESSION, type DiscoverySession } from 'shared-types'
import { subscribeToDiscovery } from '../lib/discoveryStream'

interface DiscoverySessionState {
  workspaceId: string
  session: DiscoverySession
  init: (workspaceId: string) => Promise<void>
}

let unsubscribe: (() => void) | null = null

/**
 * The workspace's live Discovery Mode session (discoverySessionStore.ts, core-backend) - fed by
 * the SSE stream (discoveryStream.ts), same lifecycle as usePresenceStore.ts: `init`
 * re-subscribes on every workspace change, tearing down the previous stream first. `workspaceId`
 * is kept here (not re-derived per call) so non-hook code (useHardwareDetection.ts,
 * useDiscoveryTrigger.ts) always knows which workspace to report into via `.getState()`.
 */
export const useDiscoverySessionStore = create<DiscoverySessionState>((set) => ({
  workspaceId: '',
  session: EMPTY_DISCOVERY_SESSION,
  init: async (workspaceId) => {
    unsubscribe?.()
    unsubscribe = null
    set({ workspaceId, session: EMPTY_DISCOVERY_SESSION })

    unsubscribe = subscribeToDiscovery(workspaceId, (session) => set({ session }))
  },
}))

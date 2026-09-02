import { create } from 'zustand'
import { DEFAULT_PRESENCE, type Presence } from 'shared-types'
import { subscribeToPresence } from '../lib/presenceStream'

interface PresenceState {
  presence: Presence
  init: (workspaceId: string) => Promise<void>
}

let unsubscribe: (() => void) | null = null

/**
 * "Who's currently logged in, from how many devices" for the active workspace - fed by the SSE
 * stream (presenceStream.ts), one shared subscription regardless of how many components read
 * it (`BandManagementView.tsx`). Wired into App.tsx via `useWorkspaceResource`, same lifecycle
 * as `usePluginsStore`'s own health subscription: `init` re-subscribes on every workspace
 * change, tearing down the previous stream first.
 */
export const usePresenceStore = create<PresenceState>((set) => ({
  presence: DEFAULT_PRESENCE,
  init: async (workspaceId) => {
    unsubscribe?.()
    unsubscribe = null
    set({ presence: DEFAULT_PRESENCE })

    unsubscribe = subscribeToPresence(workspaceId, (presence) => set({ presence }))
  },
}))

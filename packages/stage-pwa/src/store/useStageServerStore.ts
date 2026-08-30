import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface StageServerState {
  /** This device's own choice of Stage-Server address, typed in at runtime (Settings, or the
   * "Verbinden" flow in BandManagementView.tsx) - `null` until set. See stageServer.ts's
   * `getStageServerUrl()` for how this combines with the build-time `VITE_STAGE_SERVER_URL`
   * default. */
  url: string | null
  setUrl: (url: string | null) => void
}

/**
 * Lets a device that was never built with `VITE_STAGE_SERVER_URL` baked in (the normal case for
 * a solo-founded band, see the Tier-A local-only-founding follow-up) point at a Stage-Server
 * later, without a rebuild - e.g. the band buys a Mini-PC after a few solo rehearsals. Separate
 * from useWorkspaceStore.ts: this is a device-level setting (which server to talk to at all),
 * not workspace-list state.
 */
export const useStageServerStore = create<StageServerState>()(
  persist(
    (set) => ({
      url: null,
      setUrl: (url) => set({ url }),
    }),
    { name: 'stageboard-stage-server' },
  ),
)

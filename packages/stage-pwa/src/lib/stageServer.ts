import { useStageServerStore } from '../store/useStageServerStore'

/**
 * The Stage-Server base URL to use for every core-backend call in the app - a runtime setting
 * (useStageServerStore, see the Tier-A local-only-founding follow-up) takes priority over the
 * build-time `VITE_STAGE_SERVER_URL` default, so the existing dev/LAN-testing workflow
 * ([[stageboard-lan-testing]]) keeps working unchanged for anyone who hasn't set one. Plain
 * function, not a hook: called from Zustand actions and non-React modules alike, same as the
 * per-file `stageServerUrl()` helpers this replaces.
 */
export function getStageServerUrl(): string | undefined {
  return useStageServerStore.getState().url || (import.meta.env.VITE_STAGE_SERVER_URL as string | undefined)
}

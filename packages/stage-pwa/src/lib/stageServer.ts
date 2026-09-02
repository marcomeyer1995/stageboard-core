import { useStageServerStore } from '../store/useStageServerStore'

/**
 * The Stage-Server base URL to use for every core-backend call in the app - a runtime setting
 * (useStageServerStore, see the Tier-A local-only-founding follow-up) always wins. Below that,
 * a *built* app (what core-backend actually serves - the normal, single-origin case) defaults
 * to `window.location.origin` rather than the build-time `VITE_STAGE_SERVER_URL`: the page was
 * necessarily loaded from a working core-backend origin already (stageboard.local, a LAN IP,
 * localhost, ...), so hardcoding one specific hostname would make every other one look
 * unreachable (cross-origin fetch to the baked-in host, blocked by CORS). Only the Vite dev
 * server (`import.meta.env.DEV`, a separate origin from core-backend with no proxy) still needs
 * the explicit build-time value. Plain function, not a hook: called from Zustand actions and
 * non-React modules alike, same as the per-file `stageServerUrl()` helpers this replaces.
 */
export function getStageServerUrl(): string | undefined {
  const override = useStageServerStore.getState().url
  if (override) return override
  if (!import.meta.env.DEV) return window.location.origin
  return import.meta.env.VITE_STAGE_SERVER_URL as string | undefined
}

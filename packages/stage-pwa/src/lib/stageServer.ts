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
  return useStageServerStore.getState().url || getAutomaticStageServerUrl()
}

/** What `getStageServerUrl()` falls back to when this device has no manual override - the
 * address the app was loaded from (or `VITE_STAGE_SERVER_URL` under the Vite dev server). For a
 * tablet that opened the app from the Stage-Server itself this is always right, which is why the
 * Settings field is an *override* behind "Erweitert", not something to fill in. */
export function getAutomaticStageServerUrl(): string | undefined {
  if (!import.meta.env.DEV) return window.location.origin
  return import.meta.env.VITE_STAGE_SERVER_URL as string | undefined
}

/** Trimmed, without a trailing slash - so `https://stageboard.local/` and the origin
 * `https://stageboard.local` compare equal. */
export function normalizeStageServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * What a typed-in address should do to the stored override: `null` (= automatic) when it is
 * empty or just the automatic address anyway. Saving the automatic address *as* an override
 * would pin today's address on this device - after an IP change or when the app is opened via
 * `stageboard.local` instead of the IP, every server call would go to the stale, cross-origin
 * address and fail with nothing pointing back to this setting.
 */
export function overrideForTypedUrl(typed: string): string | null {
  const normalized = normalizeStageServerUrl(typed)
  if (normalized === '') return null
  const automatic = getAutomaticStageServerUrl()
  return automatic !== undefined && normalized === normalizeStageServerUrl(automatic) ? null : normalized
}

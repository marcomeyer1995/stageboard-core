import { create } from "zustand";

export type StemPlaybackStatus = "off" | "loading" | "ready" | "error";

/** What the stem player (useStemPlaybackDriver.ts) is doing - for the "Stems" widget - and which
 * stems it holds: the audio cache keeps those (useAudioSyncReconciler.ts), stems are otherwise
 * never cached. */
export const useStemPlaybackStore = create<{
  status: StemPlaybackStatus;
  cacheKeys: readonly string[];
}>(() => ({ status: "off", cacheKeys: [] }));

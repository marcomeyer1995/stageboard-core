import { create } from 'zustand'

/** What the engine in the native output holds of the track (nativeEngineTrack.ts) - its own module, so
 * the playback drivers read it without loading the rest. */
export type NativeTrackStatus = 'idle' | 'loading' | 'ready' | 'not-opus' | 'error'

export interface NativeTrackState {
  /** `variantId:trackId` of what the engine holds (or is loading). */
  key: string | null
  status: NativeTrackStatus
  error: string | null
  /** The engine plays the track now - the WebView's track (element / Web Audio) stays out. */
  active: boolean
}

export const useNativeTrackStore = create<NativeTrackState>(() => ({ key: null, status: 'idle', error: null, active: false }))

import { create } from 'zustand'
import { audioOutputLatencyMs } from './latencyProfiles'
import { getDeviceId } from './deviceId'
import { useAudioRouteStore } from '../store/useAudioRouteStore'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'

/**
 * Latency compensation from stored profiles (docs/21 §3, #491, #302): a device whose audio comes
 * out of its speaker 430 ms after it was scheduled (the Fire, measured 2026-10-13) starts click and
 * track that much earlier, so they are *heard* on the song time - together with every other device.
 */

const SWITCH_KEY = 'sb:audio:latency-compensation'

function readSwitch(): boolean {
  try {
    return localStorage.getItem(SWITCH_KEY) !== '0'
  } catch {
    return true
  }
}

/** Per device: compensation on (default) or off - e.g. to compare by ear. */
export const useAudioCompensationStore = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: readSwitch(),
  set: (on) => {
    try {
      localStorage.setItem(SWITCH_KEY, on ? '1' : '0')
    } catch {
      // Private mode / blocked storage: the switch still applies until the app is reloaded.
    }
    set({ on })
  },
}))

/** This device's audio latency to compensate right now - re-renders only when a profile, the route
 * or the switch changes. */
export function useAudioOutputLatencyMs(): number {
  const profiles = useLatencyProfilesStore((state) => state.profiles)
  const route = useAudioRouteStore((state) => state.route)
  const on = useAudioCompensationStore((state) => state.on)
  return audioOutputLatencyMs(profiles, getDeviceId(), route, on)
}

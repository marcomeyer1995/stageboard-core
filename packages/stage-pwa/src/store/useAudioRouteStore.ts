import { create } from 'zustand'
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { AudioRoute } from 'shared-types'
import { isNativeApp } from '../lib/native'

interface AudioRoutePlugin {
  getRoute(): Promise<{ route: AudioRoute }>
  addListener(event: 'change', listener: (data: { route: AudioRoute }) => void): Promise<PluginListenerHandle>
}

const AudioRoute = registerPlugin<AudioRoutePlugin>('AudioRoute')

interface AudioRouteState {
  /** Where this device's audio goes right now (`AudioRoutePlugin.java`); `unknown` in a browser. */
  route: AudioRoute
  start: () => void
}

let started = false

/** This device's current audio output route - the key of its audio latency profile (#491). */
export const useAudioRouteStore = create<AudioRouteState>((set) => ({
  route: 'unknown',
  start: () => {
    if (started || !isNativeApp()) return
    started = true
    void AudioRoute.getRoute()
      .then(({ route }) => set({ route }))
      .catch(() => {})
    void AudioRoute.addListener('change', ({ route }) => set({ route })).catch(() => {})
  },
}))

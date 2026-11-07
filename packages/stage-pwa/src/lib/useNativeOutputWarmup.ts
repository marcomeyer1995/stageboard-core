import { useEffect } from 'react'
import { nativeOutputAvailable, useNativeOutputStore } from './nativeOutput'
import { getSharedAudioContext } from './sharedAudioContext'

/**
 * Starts the native output (docs/30) when the app starts, not with the first sound: it was started
 * by whatever created the shared AudioContext first - on the Fire the first Play - and took ~0.5 s
 * to measure its latency, so the song's first beats were placed by the WebView's clock and moved
 * when the native one took over (a few misplaced clicks after Play, 2026-11-05). Android app only.
 */
export function useNativeOutputWarmup(): void {
  const wanted = useNativeOutputStore((state) => state.wanted)
  useEffect(() => {
    if (wanted && nativeOutputAvailable()) getSharedAudioContext()
  }, [wanted])
}

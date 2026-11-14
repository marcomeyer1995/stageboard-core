import { useEffect, useRef } from 'react'
import { CAPABILITIES } from 'shared-types'
import { mixGain, useOutputPlanStore } from '../audioMix'
import { getServerTime } from '../clockSync'
import { resolveTrackForEntry } from '../computeQueue'
import { useAudioOutputLatencyMs } from '../latencyCompensation'
import { setLocalTrackHeldByEngine } from '../localAudioEngine'
import { nativeEngine, useNativeOutputStore } from '../nativeOutput'
import { useShowModeCore } from '../showMode'
import { useCapabilityRouting } from '../useCapabilityRouting'
import { useStemPlaybackStore } from '../../store/useStemPlaybackStore'
import { acquireNativeEngine, feedsOf, releaseNativeEngine, sendNativeOffset, sendNativeTransport } from './nativeEngineSession'
import { TRACK_CLIP, loadNativeTrack, unloadNativeTrack, wantsNativeTrack } from './nativeEngineTrack'
import { useNativeTrackStore } from './nativeTrackStore'
import { ENGINE_BUS } from './wasmEngine'

const UPDATE_MS = 1000
const POLL_MS = 50

/**
 * Mounted with the other playback drivers. Plays this device's track in the engine while it is
 * the device that plays the track (Solo Üben, or the Gig's claimed output), the native output
 * runs and the switch is on.
 */
export function useNativeTrackDriver(): void {
  const { mode, queue, trackOverride, transport } = useShowModeCore()
  const { engine } = useCapabilityRouting(CAPABILITIES.audioPlayback, mode)
  const nativeOn = useNativeOutputStore((s) => s.state === 'on')
  const { currentEntry, currentVariant } = queue
  const track = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)
  const engineGen = useNativeOutputStore((s) => s.engineGen)
  // The track for the engine, native output running or not: a reopen (a device change, a broken
  // stream) keeps the engine and the track in it - loading it again took seconds on the Fire,
  // the track silent meanwhile (2026-11-14).
  const forEngine = engine === 'local-mine' && wantsNativeTrack() && currentVariant !== null && track !== null
  const wanted = nativeOn && forEngine
  useEffect(() => {
    useNativeTrackStore.setState({ why: { nativeOn, engine, switch: wantsNativeTrack(), variant: currentVariant?.id ?? null, track: track?.id ?? null } })
  }, [nativeOn, engine, currentVariant?.id, track?.id])
  const variantId = currentVariant?.id ?? null
  const trackId = track?.id ?? null

  // Load on every song/track change, and when the native output came up with a new engine (another
  // rate) - not when it only reopened.
  useEffect(() => {
    if (!forEngine || !variantId || !trackId) {
      if (useNativeTrackStore.getState().key !== null) unloadNativeTrack()
      return
    }
    if (!nativeOn) return
    const held = useNativeTrackStore.getState()
    if (held.key === `${variantId}:${trackId}` && held.status === 'ready' && held.engineGen === engineGen && engineGen !== null) return
    void loadNativeTrack(variantId, trackId)
  }, [forEngine, variantId, trackId, nativeOn, engineGen])

  const status = useNativeTrackStore((s) => s.status)
  const loadedKey = useNativeTrackStore((s) => s.key)
  const active = wanted && status === 'ready' && loadedKey === `${variantId}:${trackId}`
  const outputLatencyMs = useAudioOutputLatencyMs()
  const stateRef = useRef({ transport, mode, outputLatencyMs })
  stateRef.current = { transport, mode, outputLatencyMs }

  useEffect(() => {
    if (!active) return
    useNativeTrackStore.setState({ active: true })
    setLocalTrackHeldByEngine(true)
    acquireNativeEngine('track')
    const transportNow = () => (stateRef.current.mode === 'practice' ? Date.now() : getServerTime())
    const update = () => {
      sendNativeOffset(transportNow, stateRef.current.outputLatencyMs)
      // The stems play instead (docs/22 §3): the track is silent, as the element is then.
      const stem = useStemPlaybackStore.getState()
      const stems = stem.status === 'ready' && stem.stems
      nativeEngine.clipGain(TRACK_CLIP, stems ? 0 : 1)
      nativeEngine.gain(ENGINE_BUS.track, mixGain('track'))
      const [left, right] = feedsOf(useOutputPlanStore.getState().plan.track)
      nativeEngine.feeds(ENGINE_BUS.track, left, right)
      useNativeTrackStore.setState({ sent: { stems, gain: mixGain('track'), feeds: [left, right], transport: stateRef.current.transport.status } })
    }
    update()
    sendNativeTransport(stateRef.current.transport)
    const poll = setInterval(() => sendNativeTransport(stateRef.current.transport), POLL_MS)
    const slow = setInterval(update, UPDATE_MS)
    return () => {
      clearInterval(poll)
      clearInterval(slow)
      nativeEngine.clipGain(TRACK_CLIP, 0)
      releaseNativeEngine('track')
      setLocalTrackHeldByEngine(false)
      useNativeTrackStore.setState({ active: false })
    }
  }, [active])
}

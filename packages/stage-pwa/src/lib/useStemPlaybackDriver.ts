import { useEffect, useMemo } from 'react'
import { cacheKey } from './audioCache'
import { resolveTrackForEntry } from './computeQueue'
import { useAudioOutputLatencyMs } from './latencyCompensation'
import { setLocalTrackSilenced } from './localAudioEngine'
import { useShowModeCore } from './showMode'
import { useFrameLoop } from './useFrameLoop'
import { loadStems, setStemGains, setStemLevelCurve, setStemsStretched, stemsStretched, syncStems, unloadStems } from './stemEngine'
import { prepareStretch, stretchLatencyMs } from './mixStretch'
import { getSharedAudioContext } from './sharedAudioContext'
import { useTrackLevelCurve } from './trackLevel'
import { stemGains, stemMixFor, useStemMixStore } from './stemMix'
import { pickStemSet, stemSetsOf } from './stems'
import { computeActiveMs, jumpBoundaryMs, rateOf } from './playbackTransport'
import type { TrackJump } from './webAudioTrackEngine'
import { practiceTransportOf, usePracticeStateStore } from '../store/usePracticeStateStore'
import { useStemPlaybackStore } from '../store/useStemPlaybackStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Solo practice audio on Web Audio (docs/22 §3): the current song's stems when they are switched
 * on for this song on this device (stemMix.ts), otherwise its track - both through the stem engine,
 * on the click's AudioContext. One route for both (Marco, 2026-10-15): on the Xiaomi the `<audio>`
 * element went through Android's media path with Dolby and MiSound on it, Web Audio through the
 * low-latency path without them, so switching to the stems sounded like losing depth and
 * dynamics. Now track and stems sound alike, and the track is on the click's clock and latency
 * compensation too.
 *
 * The track's `<audio>` element keeps running silently - position, track end and everything that
 * follows it stay as they are - and is heard whenever the engine isn't ready (still loading,
 * failed). The loop trainer (#683) plays here too: slower, through one stretch on the whole mix.
 */
/** The song time as heard `latencyMs` (clock time) from now - across a queued section jump (#479)
 * the same way the Gig's track does (useAudioOutputDriver): past the boundary in that played-ahead
 * time, the target's time, at the target's speed (#683). Null while stopped. */
function playedAheadNow(workspaceId: string, latencyMs: number): number | null {
  const transport = practiceTransportOf(usePracticeStateStore.getState().get(workspaceId))
  if (transport.status === 'stopped') return null
  const rate = rateOf(transport)
  const played = computeActiveMs({ ...transport, jump: null }, Date.now()) + latencyMs * rate
  const boundary = jumpBoundaryMs(transport)
  return transport.jump && boundary !== null && played >= boundary ? transport.jump.toMs + ((played - boundary) / rate) * (transport.jump.rate ?? rate) : played
}

function queuedJump(workspaceId: string): TrackJump | null {
  const transport = practiceTransportOf(usePracticeStateStore.getState().get(workspaceId))
  const boundary = jumpBoundaryMs(transport)
  return transport.jump && boundary !== null
    ? { id: transport.jump.at, boundaryMs: boundary, toMs: transport.jump.toMs, ...(transport.jump.rate !== undefined ? { rate: transport.jump.rate } : {}) }
    : null
}

function practiceRate(workspaceId: string): number {
  return rateOf(practiceTransportOf(usePracticeStateStore.getState().get(workspaceId)))
}

export function useStemPlaybackDriver(): void {
  const { mode, queue, playbackStatus, trackOverride } = useShowModeCore()
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const { currentEntry, currentVariant } = queue
  // A slowed trainer session (#683) - the whole session, also its 100 % passes, so the stretch's
  // delay never changes mid-loop. At the song's own tempo nothing is stretched.
  const stretch = usePracticeStateStore((state) => {
    const practice = state.byWorkspace[workspaceId]
    return (practice?.playbackRate ?? 1) !== 1 || (practice?.playbackLoop?.rates ?? []).some((rate) => rate !== 1)
  })
  const settings = stemMixFor(
    currentVariant?.id,
    useStemMixStore((state) => state.byVariant),
  )
  const playingTrack = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)
  const set = useMemo(() => (currentVariant ? pickStemSet(stemSetsOf(currentVariant.tracks), settings.set, playingTrack?.id ?? null) : null), [currentVariant, settings.set, playingTrack?.id])
  const useStems = settings.on && set !== null && set.stems.length > 0
  const stemIds = useMemo(() => (useStems && set ? set.stems.map((s) => s.id) : playingTrack ? [playingTrack.id] : []), [useStems, set, playingTrack])
  const idsKey = stemIds.join(',')
  const wanted = mode === 'practice' && stemIds.length > 0
  const status = useStemPlaybackStore((state) => state.status)

  useEffect(() => {
    if (!wanted || !currentVariant) {
      unloadStems()
      setLocalTrackSilenced(false)
      useStemPlaybackStore.setState({ status: 'off', cacheKeys: [] })
      return
    }
    let cancelled = false
    useStemPlaybackStore.setState({
      status: 'loading',
      cacheKeys: stemIds.map((id) => cacheKey(currentVariant.id, id)),
    })
    void loadStems(currentVariant.id, stemIds).then((ok) => {
      if (cancelled) return
      setLocalTrackSilenced(ok)
      useStemPlaybackStore.setState({ status: ok ? 'ready' : 'error' })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, currentVariant?.id, idsKey])

  useEffect(() => {
    setStemGains(useStems ? stemGains(settings, stemIds) : new Map(stemIds.map((id) => [id, 1])))
  }, [useStems, settings, stemIds])

  // Track level, fades and mute by cue (#485) - in Solo as in the Gig, on the stems' sum.
  const levelCurve = useTrackLevelCurve(queue)
  useEffect(() => setStemLevelCurve(levelCurve), [levelCurve])

  // Every frame while playing, on its own loop (#457), once on every change otherwise (start, pause,
  // stop). The engine reads the song time itself, right when it reads the audio clock, shifted like
  // the click and the Gig's Web Audio track so it is heard on the song time.
  const outputLatencyMs = useAudioOutputLatencyMs()
  useEffect(() => {
    if (!stretch) {
      setStemsStretched(false)
      return
    }
    let cancelled = false
    void prepareStretch(getSharedAudioContext()).then(() => !cancelled && setStemsStretched(true))
    return () => {
      cancelled = true
    }
  }, [stretch])
  const sync = () => {
    if (status !== 'ready') return
    // Through the stretch the mix comes out later - it is played that much earlier.
    const latencyMs = outputLatencyMs + (stemsStretched() ? stretchLatencyMs() : 0)
    syncStems(
      () => playedAheadNow(workspaceId, latencyMs),
      playbackStatus === 'playing',
      () => queuedJump(workspaceId),
      () => practiceRate(workspaceId),
    )
  }
  useEffect(sync, [status, outputLatencyMs, playbackStatus, workspaceId, stretch])
  useFrameLoop(sync, status === 'ready' && playbackStatus === 'playing')

  useEffect(
    () => () => {
      unloadStems()
      setLocalTrackSilenced(false)
    },
    [],
  )
}

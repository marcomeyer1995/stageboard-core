import { useEffect, useRef, useState, type AudioHTMLAttributes, type RefObject } from 'react'
import { useElapsedMs } from './useElapsedMs'
import { useClockStore } from '../store/useClockStore'
import { trackElementVolume, useAudioMixStore } from './audioMix'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export interface TrackClock {
  /** Ticks live while playing (useElapsedMs) - the same Master-Clock `getElapsedMs()` reads
   * synchronously at tap time, just re-rendered for display. */
  elapsedMs: number
  isPlaying: boolean
  duration: number
  position: number
  togglePlay: () => void
  /** Playback speed, 1 = normal - slowed down (pitch kept) for tapping in the Timeline. */
  rate: number
  setRate: (rate: number) => void
  /** Spread directly onto an `<audio>` element: `<audio {...audioProps} />`. Bundles the ref
   * and every event handler that keeps useClockStore in lockstep with the element's own
   * playback position - a consumer never needs to touch useClockStore directly. */
  audioProps: AudioHTMLAttributes<HTMLAudioElement> & { ref: RefObject<HTMLAudioElement> }
}

/**
 * Drives a Master-Clock (`useClockStore.ts`) from a `<audio>` element's own playback position,
 * so the tools that tap or record against a real track's position (Cue Recorder, the timeline)
 * share the exact same mechanics. Without a track (`trackSrc === null`), falls back to a
 * hand-started stopwatch - callers that need the real recording should require a track before
 * rendering this.
 */
/**
 * The quietest volume the element gets: -80 dB, not 0. On Android (Redmi, 2026-10-28) an element
 * set to exactly 0 jumps ~150 ms ahead, and back when it comes up again - the end of a mute fade
 * stuttered audibly. 0.0001 is inaudible and keeps the position steady.
 */
export const SILENT_VOLUME = 0.0001

/** Beyond this the clock jumps to the element's position (a seek, a stall) instead of easing. */
export const RESYNC_MS = 50
/** How far the element must have moved after play before the clock runs. Not less: Android
 * reports a first step of ~17 ms right at play and then sits another ~250 ms (Redmi, 2026-10-28). */
const START_MOVED_MS = 40
/** ...but the clock runs after this at the latest, moved or not. */
const START_WAIT_MAX_MS = 1000
/** Deviations below this are the reports' own unevenness (measured ±13 ms) - left alone. */
const FOLLOW_DEADBAND_MS = 20
/** Share of a small deviation the clock takes per position report (~4 a second). */
const FOLLOW_SHARE = 0.1

/**
 * Where the running clock goes on an element's position report. The reports come ~4 times a
 * second and a little uneven on Android: snapping to each made the timeline's playhead jump 3 px
 * and crawl 0.5 px four times a second - it pulsed (Redmi, 2026-10-28). Small deviations are now
 * taken a tenth at a time (sub-pixel steps), real jumps at once.
 */
export function followPosition(elapsedMs: number, reportedMs: number): number {
  const error = reportedMs - elapsedMs
  if (Math.abs(error) > RESYNC_MS) return reportedMs
  // The reports' own unevenness: leave it, a correction would only cost a render.
  if (Math.abs(error) < FOLLOW_DEADBAND_MS) return elapsedMs
  return elapsedMs + error * FOLLOW_SHARE
}

export function useTrackClock(trackSrc: string | null, trackLevel?: RefObject<((ms: number) => number) | null>): TrackClock {
  const elapsedMs = useElapsedMs()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)

  useEffect(() => {
    useClockStore.getState().reset()
    // Without a track there's no audio to press play on - keep the original
    // start-immediately stopwatch behavior so tapping still works.
    if (!trackSrc) useClockStore.getState().start()
    return () => {
      useClockStore.getState().stop()
    }
  }, [trackSrc])

  // Slowed playback (pitch kept): the element and the clock run at the same rate, so taps and
  // the click stay in song time. Back to normal for the next track and when leaving.
  const [rate, setRateState] = useState(1)
  function setRate(next: number) {
    setRateState(next)
    useClockStore.getState().setRate(next)
    const audio = audioRef.current
    if (audio) {
      audio.preservesPitch = true
      audio.playbackRate = next
    }
  }
  useEffect(() => {
    setRateState(1)
    useClockStore.getState().setRate(1)
    return () => useClockStore.getState().setRate(1)
  }, [trackSrc])

  // "Mein Mix" (docs/21 §9.3): the track's slider sets this element's volume, also mid-song.
  const trackVolume = useAudioMixStore((state) => trackElementVolume(state.mix))
  // Track level cues (#485: "Track stumm über 2 Takte"), heard here as in the show: the element's
  // volume follows the level curve at its own position - every frame while it plays, once on a
  // seek. An element can't go above 1, so a cue that raises the track plays at full volume here.
  const applyVolume = useRef(() => {})
  applyVolume.current = () => {
    const audio = audioRef.current
    if (!audio) return
    const level = trackLevel?.current ? trackLevel.current(audio.currentTime * 1000) : 1
    audio.volume = Math.min(1, Math.max(SILENT_VOLUME, trackVolume * level))
  }
  useEffect(() => applyVolume.current(), [trackVolume, trackSrc])
  useEffect(() => {
    if (!isPlaying || !trackLevel) return
    let frame = requestAnimationFrame(function tick() {
      applyVolume.current()
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, trackLevel])

  const startWait = useRef<number | null>(null)
  function cancelStartWait() {
    if (startWait.current !== null) cancelAnimationFrame(startWait.current)
    startWait.current = null
  }
  useEffect(() => cancelStartWait, [])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    // play() returns a promise that rejects with AbortError if pause() interrupts it before
    // it resolves (e.g. a quick double-tap) - expected, not a bug.
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  const audioProps: TrackClock['audioProps'] = {
    ref: audioRef,
    src: trackSrc ?? undefined,
    onLoadedMetadata: (e) => setDuration(e.currentTarget.duration),
    onPlay: (e) => {
      setIsPlaying(true)
      // The clock starts once the element really moves - Android's player sits ~200 ms on its
      // position after play, and a clock running from the tap was then snapped back by the first
      // position report: the playhead started, jumped back, started again (Redmi, 2026-10-28).
      const audio = e.currentTarget
      const fromMs = audio.currentTime * 1000
      const since = performance.now()
      cancelStartWait()
      const check = () => {
        const nowMs = audio.currentTime * 1000
        if (nowMs - fromMs < START_MOVED_MS && performance.now() - since < START_WAIT_MAX_MS) {
          startWait.current = requestAnimationFrame(check)
          return
        }
        startWait.current = null
        const clock = useClockStore.getState()
        clock.start()
        clock.seek(nowMs)
      }
      startWait.current = requestAnimationFrame(check)
    },
    onPause: () => {
      cancelStartWait()
      setIsPlaying(false)
      useClockStore.getState().stop()
    },
    onEnded: () => {
      cancelStartWait()
      setIsPlaying(false)
      useClockStore.getState().stop()
    },
    onTimeUpdate: (e) => {
      // Each report used to re-render the whole timeline twice - a late frame 4 times a second.
      // The position shows whole seconds, and the clock only moves when it has to.
      const currentTime = e.currentTarget.currentTime
      setPosition((prev) => (Math.floor(prev) === Math.floor(currentTime) ? prev : currentTime))
      const clock = useClockStore.getState()
      const reportedMs = currentTime * 1000
      if (!clock.isRunning) clock.seek(reportedMs)
      else {
        const elapsedMs = clock.getElapsedMs()
        const nextMs = followPosition(elapsedMs, reportedMs)
        if (nextMs !== elapsedMs) clock.seek(nextMs)
      }
    },
    onSeeked: (e) => {
      useClockStore.getState().seek(e.currentTarget.currentTime * 1000)
      applyVolume.current()
    },
  }

  return { elapsedMs, isPlaying, duration, position, togglePlay, rate, setRate, audioProps }
}

export { formatTime as formatTrackClockTime }

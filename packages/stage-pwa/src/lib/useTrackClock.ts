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
    audio.volume = Math.min(1, Math.max(0, trackVolume * level))
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
    onPlay: () => {
      setIsPlaying(true)
      useClockStore.getState().start()
    },
    onPause: () => {
      setIsPlaying(false)
      useClockStore.getState().stop()
    },
    onEnded: () => {
      setIsPlaying(false)
      useClockStore.getState().stop()
    },
    onTimeUpdate: (e) => {
      setPosition(e.currentTarget.currentTime)
      useClockStore.getState().seek(e.currentTarget.currentTime * 1000)
    },
    onSeeked: (e) => {
      useClockStore.getState().seek(e.currentTarget.currentTime * 1000)
      applyVolume.current()
    },
  }

  return { elapsedMs, isPlaying, duration, position, togglePlay, rate, setRate, audioProps }
}

export { formatTime as formatTrackClockTime }

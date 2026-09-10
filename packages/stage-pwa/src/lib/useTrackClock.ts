import { useEffect, useRef, useState, type AudioHTMLAttributes, type RefObject } from 'react'
import { useElapsedMs } from './useElapsedMs'
import { useClockStore } from '../store/useClockStore'

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
  /** Spread directly onto an `<audio>` element: `<audio {...audioProps} />`. Bundles the ref
   * and every event handler that keeps useClockStore in lockstep with the element's own
   * playback position - a consumer never needs to touch useClockStore directly. */
  audioProps: AudioHTMLAttributes<HTMLAudioElement> & { ref: RefObject<HTMLAudioElement> }
}

/**
 * Drives a Master-Clock (`useClockStore.ts`) from a `<audio>` element's own playback position -
 * extracted out of TapToSync.tsx, which originally had this inlined (#25 follow-up: TapBeatAnchors.tsx
 * needs the exact same "tap in time with a real track's actual position" mechanics, and this is
 * a pure extraction of TapToSync's own logic, no behavior change there). Without a track
 * (`trackSrc === null`), falls back to a hand-started stopwatch so tapping still works with
 * nothing to sync against - callers that have no audio-less fallback of their own (unlike
 * TapToSync's line-tapping, which does) should simply require a track before rendering this.
 */
export function useTrackClock(trackSrc: string | null): TrackClock {
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
    onSeeked: (e) => useClockStore.getState().seek(e.currentTarget.currentTime * 1000),
  }

  return { elapsedMs, isPlaying, duration, position, togglePlay, audioProps }
}

export { formatTime as formatTrackClockTime }

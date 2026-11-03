import { useEffect, useRef } from 'react'

/**
 * Runs `onFrame` on every animation frame while `active` - for work that has to follow the song
 * clock frame by frame (keeping a track or the stems on it) without re-rendering a component for it
 * (#457): the caller re-renders on song and state changes only, the loop reads the clock itself.
 * The latest `onFrame` is used, so it may close over the current render's values.
 */
export function useFrameLoop(onFrame: () => void, active: boolean): void {
  const ref = useRef(onFrame)
  ref.current = onFrame
  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      ref.current()
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [active])
}

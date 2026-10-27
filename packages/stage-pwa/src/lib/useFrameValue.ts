import { useEffect, useRef, useState } from 'react'

/**
 * A value derived from the running song clock that re-renders its component only when it changes
 * (#457): read every animation frame while `active`, kept when equal - a time shown to the second
 * re-renders once a second, not sixty times. Inactive (stopped, paused) it is read at render, the
 * component re-renders with its state anyway.
 */
export function useFrameValue<T>(read: () => T, active: boolean, equal: (a: T, b: T) => boolean = Object.is): T {
  const readRef = useRef(read)
  readRef.current = read
  const equalRef = useRef(equal)
  equalRef.current = equal
  const [value, setValue] = useState(read)
  // Whether `value` was read in the current active period. Until the first frame of a new one it is
  // what the last period left behind - "past the end" from the song before stopped the next song
  // the moment it started (Rig-Check end-to-end test, 2026-10-27).
  const freshRef = useRef(false)
  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      const next = readRef.current()
      freshRef.current = true
      setValue((previous) => (equalRef.current(previous, next) ? previous : next))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(frame)
      freshRef.current = false
    }
  }, [active])
  return active && freshRef.current ? value : read()
}

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
  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      const next = readRef.current()
      setValue((previous) => (equalRef.current(previous, next) ? previous : next))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [active])
  return active ? value : read()
}

import { useEffect, useRef, useState } from 'react'
import { configLog } from './configDebug'

const COMMIT_DEBOUNCE_MS = 150

/**
 * A range/slider input backed by a store-persisted value (`value`/`onCommit`) needs its own
 * local, instantly-responsive display state - committing straight through on every `input`
 * tick (as a naive controlled `<input type="range">` does) round-trips through a real
 * PouchDB `put()` on every pixel of drag movement (Dashboard.tsx's `updateConfig` -> `save`),
 * and for a widget with any non-trivial render cost (PrompterWidget re-parses its whole
 * ChordPro content on every render) that write-triggered re-render pressure is what made the
 * slider itself visibly stutter (Marco, 2026-09-14: "ruckelig ... nicht wirklich gut
 * nutzbar"), not the input element itself.
 *
 * `onDrag` fires on every tick for instant visual feedback (bump the local display value,
 * no persistence). The actual `onCommit` (passed fresh on every render, like any callback
 * prop) is debounced during continuous dragging via a ref - always the latest closure, never
 * stale - and always flushed once movement stops (pointer up, blur, or unmount), so the
 * slider feels live without a write on every pixel, and the final position is never lost.
 */
export function useDeferredSliderValue<T>(
  value: T,
  onCommit: (next: T) => void,
  debugLabel?: string,
): [T, (next: T) => void, () => void] {
  const [display, setDisplay] = useState(value)
  const pendingRef = useRef<T | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  // Stay in sync with external changes (another device editing the same widget, or the
  // config resetting) - but not while this device has its own pending edit in flight, or
  // the live value ticking back in from CouchDB sync would fight the user's own drag.
  useEffect(() => {
    if (pendingRef.current === null) {
      configLog(debugLabel ?? '(slider)', 'external value ->', value, '(applying to display)')
      setDisplay(value)
    } else {
      configLog(
        debugLabel ?? '(slider)',
        'external value ->',
        value,
        'IGNORED, pending local edit',
        pendingRef.current,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debugLabel is a static id, not a real dependency
  }, [value])

  const flushRef = useRef<() => void>(() => {})
  flushRef.current = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current !== null) {
      configLog(debugLabel ?? '(slider)', 'flush -> commit', pendingRef.current)
      onCommitRef.current(pendingRef.current)
      pendingRef.current = null
    }
  }

  function onDrag(next: T) {
    configLog(debugLabel ?? '(slider)', 'drag ->', next)
    setDisplay(next)
    pendingRef.current = next
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => flushRef.current(), COMMIT_DEBOUNCE_MS)
  }

  useEffect(() => () => flushRef.current(), [])

  return [display, onDrag, () => flushRef.current()]
}

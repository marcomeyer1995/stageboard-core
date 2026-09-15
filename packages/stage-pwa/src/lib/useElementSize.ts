import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/** Rapid-fire ResizeObserver churn (a mobile browser's address bar animating in/out as it's
 * touched, an on-screen keyboard opening) used to propagate every single intermediate frame
 * straight into consumers - Dashboard.tsx passes width/height on through to react-grid-
 * layout's rowHeight/width props on an already-mounted grid instance (no remount, unlike a
 * genuine dashboard switch), which is the same "prop changed without a remount -> the
 * library resyncs against its own now-stale internal state instead of the fresh props for a
 * render or two, regenerating a slightly different layout every time" class of bug
 * Dashboard.tsx's own `key={active.id}:${resetNonce}` remount already exists to sidestep for
 * `layouts` - just not guarded here for size (found live, 2026-09-15: "widgets jumping and
 * resizing" in an already-open tab, gone after a reload - a reload is itself nothing but a
 * forced full remount, consistent with this exact bug class). Debouncing so a burst of
 * observer firings collapses into the one settled value at the end, instead of each
 * intermediate frame reaching react-grid-layout as its own separate prop change. */
const RESIZE_DEBOUNCE_MS = 150

/**
 * Observes an element's content-box size. Uses a callback ref, not a plain `useRef` +
 * `useEffect([ref], ...)`: Dashboard.tsx conditionally skips rendering the observed div
 * until its data has loaded, so on first mount the effect can run before that div exists
 * at all. A plain ref's identity never changes, so an effect keyed on it only ever gets
 * one chance to see `ref.current` - if that first look finds `null`, no observer is ever
 * created, and width/height stay stuck at 0 forever even once the div does appear. A
 * callback ref instead fires every time the node is actually attached or detached, so the
 * observer (re)attaches exactly when there is something to measure.
 */
export function useElementSize(): [RefCallback<HTMLElement>, ElementSize] {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ref = useCallback<RefCallback<HTMLElement>>((element) => {
    setNode(element)
  }, [])

  useEffect(() => {
    if (!node) return

    // The very first measurement is applied immediately, not debounced - nothing to settle
    // yet, and delaying it would just add a blank flash before the grid's first real paint.
    setSize({ width: node.clientWidth, height: node.clientHeight })
    const observer = new ResizeObserver(([entry]) => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      const { width, height } = entry.contentRect
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        setSize({ width, height })
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [node])

  return [ref, size]
}

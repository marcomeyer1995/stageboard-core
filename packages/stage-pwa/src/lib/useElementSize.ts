import { useCallback, useEffect, useState, type RefCallback } from 'react'

export interface ElementSize {
  width: number
  height: number
}

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

  const ref = useCallback<RefCallback<HTMLElement>>((element) => {
    setNode(element)
  }, [])

  useEffect(() => {
    if (!node) return

    setSize({ width: node.clientWidth, height: node.clientHeight })
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [ref, size]
}

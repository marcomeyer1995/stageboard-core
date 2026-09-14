import { useLayoutEffect, useRef, useState } from 'react'

interface AutoFitOptions {
  min?: number
  max?: number
}

/**
 * Binary-searches the largest font size (px) at which `textRef`'s content still fits inside
 * `containerRef`'s box, re-running on every resize (ResizeObserver) and whenever `deps`
 * change (the text itself, e.g. a song title, changes length independently of any resize).
 * A comparison spike against VisualMetronomeWidget's CSS container-query approach (#22
 * follow-up, Marco 2026-09-14 wanted to see both before picking one) - unlike a pure cqw/cqh
 * scale, this actually measures the rendered text, so a widget that's short-and-wide vs.
 * tall-and-narrow both get the true largest size that avoids overflow/clipping, not just a
 * size proportional to the container's own dimensions. The cost: several synchronous
 * layout reads (`scrollWidth`/`scrollHeight`) per resize frame - on a slow device, dragging
 * to resize this widget can visibly lag in a way the pure-CSS approach never does.
 */
export function useAutoFitFontSize<C extends HTMLElement, T extends HTMLElement>(
  options: AutoFitOptions = {},
  deps: unknown[] = [],
): [(el: C | null) => void, (el: T | null) => void, number] {
  const { min = 8, max = 200 } = options
  const containerRef = useRef<C | null>(null)
  const textRef = useRef<T | null>(null)
  const [fontSize, setFontSize] = useState(max)

  function fit() {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return

    let lo = min
    let hi = max
    let best = min
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2)
      text.style.fontSize = `${mid}px`
      const fits = text.scrollWidth <= container.clientWidth && text.scrollHeight <= container.clientHeight
      if (fits) {
        best = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    text.style.fontSize = `${best}px`
    setFontSize(best)
  }

  // `deps` is an intentionally caller-provided, variable-length dependency list (the measured
  // text's own content) - eslint-plugin-react-hooks can't verify through that indirection.
  /* eslint-disable react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    fit()
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    return () => observer.disconnect()
  }, deps)
  /* eslint-enable react-hooks/exhaustive-deps */

  return [
    (el) => {
      containerRef.current = el
    },
    (el) => {
      textRef.current = el
    },
    fontSize,
  ]
}

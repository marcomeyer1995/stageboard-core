import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Reading speed of the one pass, CSS px per second. */
const SCROLL_PX_PER_S = 40
const START_DELAY_MS = 1000
const HOLD_AT_END_MS = 1500

/**
 * A one-line text that, when it doesn't fit, scrolls through **once** whenever `cycleKey` changes
 * (a new song) and then rests truncated with "…" (#373, Marco's choice b: no endless marquee -
 * moving text on stage pulls the eye). Without motion support or with reduced motion it simply
 * stays truncated.
 */
export function ScrollOnceText({ cycleKey, className = '', children }: { cycleKey: string; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [scrolling, setScrolling] = useState(false)

  useEffect(() => {
    const box = outer.current
    const text = inner.current
    if (!box || !text || typeof text.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const overflow = text.scrollWidth - box.clientWidth
    if (overflow <= 0) return
    const travelMs = (overflow / SCROLL_PX_PER_S) * 1000
    const total = START_DELAY_MS + travelMs + HOLD_AT_END_MS
    setScrolling(true)
    const animation = text.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: START_DELAY_MS / total },
        { transform: `translateX(${-overflow}px)`, offset: (START_DELAY_MS + travelMs) / total },
        { transform: `translateX(${-overflow}px)`, offset: 1 },
      ],
      { duration: total, easing: 'linear' },
    )
    animation.onfinish = () => setScrolling(false)
    return () => {
      animation.cancel()
      setScrolling(false)
    }
  }, [cycleKey])

  return (
    <span ref={outer} className={`block overflow-hidden ${className}`}>
      <span ref={inner} className={scrolling ? 'inline-block whitespace-nowrap' : 'block truncate'}>
        {children}
      </span>
    </span>
  )
}

import { useRef, type TouchEvent } from 'react'

/** How far and how straight a finger must move sideways before it counts as a swipe. */
const MIN_DISTANCE_PX = 80
const MAX_DURATION_MS = 700

/** Things that use a sideways drag themselves - a swipe starting on them never switches the tab. */
const OWN_GESTURE = 'input, textarea, select, [role="slider"], [contenteditable="true"], [data-no-tab-swipe]'

/** True when the touch started inside something that scrolls sideways (a tab strip, a wide table). */
function inSidewaysScroller(target: Element, root: Element): boolean {
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX
      if (overflow === 'auto' || overflow === 'scroll') return true
    }
  }
  return false
}

/**
 * Swipe left/right on a page to go to the next/previous tab (System, 2026-10-20). Only a clear,
 * quick sideways move counts - scrolling up and down, sliders, fields and sideways strips keep
 * their own gesture. Touch events, not pointer events: with `touch-action: pan-y` around, the
 * browser cancels the pointer before a horizontal move is over.
 */
export function useTabSwipe<T extends string>(tabs: readonly T[], active: T, onChange: (tab: T) => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null)
  return {
    onTouchStart: (e: TouchEvent<HTMLElement>) => {
      const touch = e.touches[0]
      const target = e.target as Element
      if (e.touches.length !== 1 || !touch || target.closest(OWN_GESTURE) || inSidewaysScroller(target, e.currentTarget)) {
        start.current = null
        return
      }
      start.current = { x: touch.clientX, y: touch.clientY, at: e.timeStamp }
    },
    onTouchEnd: (e: TouchEvent<HTMLElement>) => {
      const from = start.current
      start.current = null
      const touch = e.changedTouches[0]
      if (!from || !touch) return
      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < 2 * Math.abs(dy) || e.timeStamp - from.at > MAX_DURATION_MS) return
      const next = tabs[tabs.indexOf(active) + (dx < 0 ? 1 : -1)]
      if (next !== undefined) onChange(next)
    },
  }
}

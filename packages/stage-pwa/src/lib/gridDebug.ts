import type { LayoutItem } from 'shared-types'

/**
 * Live trace for the drag/resize rubber-band logic (Dashboard.tsx + resolveInteraction).
 * Off by default so it stays quiet in normal use. Enable from the devtools console with
 * `localStorage.setItem('sb:debug:grid', '1')` and reload, disable by removing the key.
 */
const KEY = 'sb:debug:grid'

export function gridDebugEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function fmtItems(items: LayoutItem[]): string {
  return items.map(({ i, x, y, w, h }) => `${i}:[${x},${y} ${w}x${h}]`).join(' ')
}

export function gridLog(...args: unknown[]): void {
  if (gridDebugEnabled()) console.log('[grid]', ...args)
}

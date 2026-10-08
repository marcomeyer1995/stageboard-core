import { useEffect, useState } from 'react'

/** True while the CSS media query matches - e.g. `(max-height: 420px)` for a phone in landscape. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    // Older Safari only knows addListener.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update)
      return () => list.removeEventListener('change', update)
    }
    list.addListener?.(update)
    return () => list.removeListener?.(update)
  }, [query])
  return matches
}

/** A very low screen: a phone in landscape, where the browser's bars leave under 300 px of height
 * (measured 2026-10-08: 792 × 277 on Marco's phone in Chrome). Dialogs and the ☰ menu save
 * height there. */
export const LOW_SCREEN = '(max-height: 420px)'

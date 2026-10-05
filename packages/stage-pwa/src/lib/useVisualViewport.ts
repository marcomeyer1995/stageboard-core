import { useEffect, useState } from 'react'

export interface VisualViewportBox {
  /** Distance of the visible area from the layout viewport's top, CSS px. */
  offsetTop: number
  /** Height of the part of the page that is actually visible, CSS px. */
  height: number
}

function read(): VisualViewportBox | null {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  return vv ? { offsetTop: vv.offsetTop, height: vv.height } : null
}

/**
 * The area the user can actually see (#375). An on-screen keyboard shrinks only the *visual*
 * viewport on Android - a `fixed inset-0` overlay keeps the full layout height, so a centred
 * dialog ends up behind the keyboard (GUI check 2026-10-04: "Neue Setlist" on the Fire in
 * landscape, input and buttons hidden). Overlays size themselves to this box instead.
 * `null` where the browser has no visualViewport - callers then keep their plain CSS layout.
 */
export function useVisualViewport(): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(read)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setBox(read())
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return box
}

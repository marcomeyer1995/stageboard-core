import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBackHandler } from '../../lib/backNavigation'
import { Button } from './Button'
import { PrepTier } from './PrepTier'
import { LOW_SCREEN, useMediaQuery } from '../../lib/useMediaQuery'

/** A swipe of this many px toward the drawer's own edge closes it. */
const SWIPE_CLOSE_PX = 60

export interface DrawerProps {
  title: string
  /** left = ☰ (where to go), right = bento (which dashboard) - docs/15 D8. */
  side: 'left' | 'right'
  onClose: () => void
  /** The status bar is hidden: ☰ and the nine dots sit as corner buttons in its empty place, so the
   * drawer starts below that place - exactly where it starts under the status bar (Marco,
   * 2026-10-17: switching Gig ↔ Solo Üben between such dashboards made the entries jump). */
  clearCornerButtons?: boolean
  children: ReactNode
}

/**
 * A panel that slides in from the screen edge (docs/15 D8, Marco 2026-10-16: the ☰ menu as a
 * dialog in the middle didn't feel like going somewhere; a drawer from the side is what ☰ means on
 * every phone). It only opens on a tap on its button - no swipe from the edge, which could open it
 * by accident mid-song. Closing like every dialog (D6): "Fertig" in the fixed bottom row, a tap
 * beside it, the Back gesture - and a swipe back toward its edge.
 *
 * It slides in below the status bar, not over it (Marco, 2026-10-16): ☰ and the nine dots stay
 * where they are - yellow while their drawer is open - and close it again; the song and its state
 * stay in sight. So no title row: the yellow symbol says which drawer this is. Rendered in place
 * (the screen area under the status bar), not portalled over the whole page.
 */
export function Drawer({ title, side, onClose, clearCornerButtons = false, children }: DrawerProps) {
  useBackHandler(onClose)
  const low = useMediaQuery(LOW_SCREEN)
  // Mounted off screen, moved in on the next frame - so the slide is visible.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const pressedBackdrop = useRef(false)
  const swipeStartX = useRef<number | null>(null)
  const hidden = side === 'left' ? '-translate-x-full' : 'translate-x-full'

  return (
    // The drawer belongs to the stage (docs/15 D10) - stage sizes even when opened over the Bibliothek.
    <PrepTier on={false}>
      <div
        className={`absolute inset-x-0 bottom-0 ${clearCornerButtons ? 'top-14' : 'top-0'} z-menu flex bg-scrim/60 ${side === 'left' ? 'justify-start' : 'justify-end'}`}
        onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
        onClick={(e) => {
          if (pressedBackdrop.current && e.target === e.currentTarget) onClose()
          pressedBackdrop.current = false
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-side={side}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => (swipeStartX.current = e.clientX)}
          onPointerUp={(e) => {
            const start = swipeStartX.current
            swipeStartX.current = null
            if (start === null) return
            const towardEdge = side === 'left' ? start - e.clientX : e.clientX - start
            if (towardEdge > SWIPE_CLOSE_PX) onClose()
          }}
          className={`flex h-full w-[min(24rem,88vw)] landscape:w-[min(30rem,88vw)] flex-col border-line bg-surface shadow-sb transition-transform duration-200 ease-out motion-reduce:transition-none ${
            side === 'left' ? 'border-r' : 'border-l'
          } ${shown ? 'translate-x-0' : hidden}`}
        >
          {/* [&>*]:flex-shrink-0: when the entries are taller than the screen they scroll - they used to
              squeeze rows like "Band" / "Ich bin" to half their height (2026-10-16). */}
          <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto [&>*]:flex-shrink-0 ${low ? 'gap-3 p-3' : 'gap-4 p-4'}`}>{children}</div>
          <div className={`flex flex-shrink-0 items-center justify-end border-t border-line ${low ? 'px-3 py-1.5' : 'px-4 py-3'}`}>
            <Button variant="primary" onClick={onClose}>
              Fertig
            </Button>
          </div>
        </div>
      </div>
    </PrepTier>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../../lib/backNavigation'
import { Button } from './Button'
import { LOW_SCREEN, useMediaQuery } from '../../lib/useMediaQuery'

/** A swipe of this many px toward the drawer's own edge closes it. */
const SWIPE_CLOSE_PX = 60

export interface DrawerProps {
  title: string
  /** left = ☰ (where to go), right = bento (which dashboard) - docs/15 D8. */
  side: 'left' | 'right'
  onClose: () => void
  children: ReactNode
}

/**
 * A panel that slides in from the screen edge (docs/15 D8, Marco 2026-10-16: the ☰ menu as a
 * dialog in the middle didn't feel like going somewhere; a drawer from the side is what ☰ means on
 * every phone). It only opens on a tap on its button - no swipe from the edge, which could open it
 * by accident mid-song. Closing like every dialog (D6): "Fertig" in the fixed bottom row, a tap
 * beside it, the Back gesture - and a swipe back toward its edge.
 */
export function Drawer({ title, side, onClose, children }: DrawerProps) {
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

  return createPortal(
    <div
      className={`fixed inset-x-0 top-0 h-dvh z-dialog flex bg-scrim/60 ${side === 'left' ? 'justify-start' : 'justify-end'}`}
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
        className={`sb-pad-safe flex h-full w-[min(24rem,88vw)] flex-col border-line bg-surface shadow-sb transition-transform duration-200 ease-out motion-reduce:transition-none ${
          side === 'left' ? 'border-r' : 'border-l'
        } ${shown ? 'translate-x-0' : hidden}`}
      >
        <div className={low ? 'sr-only' : 'flex flex-shrink-0 items-center border-b border-line px-4 py-3'}>
          <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
        </div>
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${low ? 'gap-3 p-3' : 'gap-4 p-4'}`}>{children}</div>
        <div className={`flex flex-shrink-0 items-center justify-end border-t border-line ${low ? 'px-3 py-1.5' : 'px-4 py-3'}`}>
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

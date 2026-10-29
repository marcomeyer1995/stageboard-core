import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { FOCUS } from './styles'
import { useTranslation } from 'react-i18next'

/** Gap between the bubble and the screen edge, and between ⓘ and the bubble. */
const EDGE_PX = 12
const MAX_WIDTH_PX = 320

/**
 * An explanation behind ⓘ (docs/15 D12, #625): small and grey beside a heading or label; a tap
 * opens a bubble over the content - nothing moves - and a tap outside, Esc, scrolling or ⓘ again
 * closes it. Warnings, status and consequences stay visible text; only explanations go here.
 * The bubble lives in a portal, placed from ⓘ's position and kept on screen, so neither a
 * scrolling pane nor the phone's width cuts it off.
 */
export function InfoHint({ text, label: labelProp }: { text: string; label?: string }) {
  const { t } = useTranslation('common')
  const label = labelProp ?? t('ui.explanation')
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ top: number; left: number; width: number; arrow: number; above: boolean } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const anchor = button.current.getBoundingClientRect()
    const width = Math.min(MAX_WIDTH_PX, window.innerWidth - 2 * EDGE_PX)
    const centre = anchor.left + anchor.width / 2
    const left = Math.min(Math.max(EDGE_PX, centre - 28), window.innerWidth - EDGE_PX - width)
    const height = bubble.current?.offsetHeight ?? 0
    // Below ⓘ, unless there is no room there and more above.
    const above = anchor.bottom + EDGE_PX + height > window.innerHeight && anchor.top > window.innerHeight - anchor.bottom
    const top = above ? anchor.top - EDGE_PX / 2 - height : anchor.bottom + EDGE_PX / 2
    setPlace({ top, left, width, arrow: centre - left, above })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e.target instanceof Node && (bubble.current?.contains(e.target) || button.current?.contains(e.target))) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setPlace(null)
          setOpen((was) => !was)
        }}
        className={`sb-hit sb-hit-square inline-flex h-prep w-prep flex-shrink-0 items-center justify-center rounded-control align-middle ${
          open ? 'text-accent' : 'text-ink-faint'
        } ${FOCUS}`}
      >
        <Icon name="info" size="1.25rem" />
      </button>
      {open &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="note"
            className="fixed z-alert rounded-control bg-ink px-4 py-3 text-base font-normal normal-case tracking-normal text-surface shadow-sb"
            style={place ? { top: place.top, left: place.left, width: place.width } : { top: 0, left: 0, width: MAX_WIDTH_PX, visibility: 'hidden' }}
          >
            {place && (
              <span
                aria-hidden="true"
                className="absolute h-3 w-3 rotate-45 bg-ink"
                style={{ left: Math.min(Math.max(place.arrow - 6, 12), place.width - 24), [place.above ? 'bottom' : 'top']: -6 }}
              />
            )}
            <span className="relative">{text}</span>
          </div>,
          document.body,
        )}
    </>
  )
}

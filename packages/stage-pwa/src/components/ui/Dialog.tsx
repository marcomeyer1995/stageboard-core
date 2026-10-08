import { useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../../lib/backNavigation'
import { Button } from './Button'
import { CONTAINER } from './styles'

const WIDTH = { s: 'max-w-sm', m: 'max-w-md', l: 'max-w-3xl', xl: 'max-w-6xl' } as const

export interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Something to confirm (D6): the bottom row - secondary ("Abbrechen") left, main action right. */
  actions?: ReactNode
  /** Without `actions`: the single button that closes - "Fertig" (changes apply at once), or e.g.
   * "Abbrechen" for a menu where choosing an entry already closes it. */
  closeLabel?: string
  size?: keyof typeof WIDTH
}

/**
 * Every dialog (D6): the way out is always in the same place - the fixed bottom row, which never
 * scrolls away and sits under the thumb (Marco, 2026-10-07: top in one dialog and bottom in the
 * next was inconsistent; "Schließen" and "Abbrechen" twice was redundant). With something to
 * confirm: "Abbrechen" left, main action right. Without: one "Fertig" on the right. The title row
 * only names the dialog. Back gesture and a tap beside the dialog close it.
 */
export function Dialog({ title, onClose, children, actions, closeLabel = 'Fertig', size = 'm' }: DialogProps) {
  useBackHandler(onClose)
  const typing = useTypingOnTouch()
  return createPortal(
    // h-dvh like DialogHost: the visible height, not the large viewport behind a browser's toolbar -
    // with max-h-full below, the bottom row with "Fertig" could end up behind it (#432 review).
    <div className={`fixed inset-x-0 top-0 h-dvh z-dialog flex justify-center bg-black/60 sb-pad-safe ${typing.active ? 'items-start' : 'items-center'}`} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-typing={typing.active || undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={typing.onPointerDown}
        onFocus={typing.onFocus}
        onBlur={typing.onBlur}
        // While typing on a touchscreen the dialog moves up and takes at most 38 % of the screen,
        // so its bottom row stays above the on-screen keyboard: the tablet browser lays the
        // keyboard over the page without telling it (Fire Silk, measured 2026-10-07: 333 of 686 px stay visible in landscape).
        // Otherwise all the height the backdrop's safe padding leaves (max-h-full) - the Xiaomi in
        // landscape Chrome has only 513 px, and 90 % of it made the ☰ menu scroll.
        className={`flex ${typing.active ? 'max-h-[38vh]' : 'max-h-full'} w-full ${WIDTH[size]} flex-col overflow-hidden border border-line bg-surface shadow-sb ${CONTAINER}`}
      >
        <div className="flex flex-shrink-0 items-center border-b border-line px-4 py-3">
          <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">{children}</div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          {actions ?? (
            <Button variant="primary" onClick={onClose} className="ml-auto">
              {closeLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const TEXT_INPUT = /^(text|search|email|url|tel|password|number|time|date|datetime-local)$/

/** True while a text field inside the dialog has focus on a touch device after a tap on it (= the
 * on-screen keyboard is up). A field focused by `autoFocus` alone doesn't count: Android opens the
 * keyboard only on a real tap, and shrinking for nothing hid "Neue Setlist"'s song list (Fire,
 * 2026-10-07). */
function useTypingOnTouch() {
  const [active, setActive] = useState(false)
  const tapped = useRef(false)
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const isText = (el: EventTarget | null) =>
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT.test(el.type))
  return {
    active,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      tapped.current = isText(e.target)
      if (coarse && tapped.current && document.activeElement === e.target) setActive(true)
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (coarse && tapped.current && isText(e.target)) setActive(true)
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!isText(e.relatedTarget)) {
        tapped.current = false
        setActive(false)
      }
    },
  }
}

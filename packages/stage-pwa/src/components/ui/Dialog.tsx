import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../../lib/backNavigation'
import { Button } from './Button'
import { PrepTier } from './PrepTier'
import { CONTAINER } from './styles'
import { LOW_SCREEN, useMediaQuery } from '../../lib/useMediaQuery'
import { useTranslation } from 'react-i18next'
import { useSettledTouchKeyboardOpen } from '../../lib/useTouchKeyboardOpen'
import { useSettledVisualViewport } from '../../lib/useVisualViewport'

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
  /** false: a tap beside the dialog does nothing - for a form whose input a stray tap would throw
   * away ("Neuer Song": only "Abbrechen"/"Weiter" close it, Marco 2026-10-09). */
  closeOnBackdrop?: boolean
  /** While a slider in it is dragged, the dialog and the dimming behind it turn see-through - for
   * settings whose effect shows behind it, e.g. a widget's text size (Marco, 2026-10-17). */
  seeThroughWhileSliding?: boolean
}

/**
 * Every dialog (D6): the way out is always in the same place - the fixed bottom row, which never
 * scrolls away and sits under the thumb (Marco, 2026-10-07: top in one dialog and bottom in the
 * next was inconsistent; "Schließen" and "Abbrechen" twice was redundant). With something to
 * confirm: "Abbrechen" left, main action right. Without: one "Fertig" on the right. The title row
 * only names the dialog. Back gesture and a tap beside the dialog close it (unless `closeOnBackdrop`
 * is false).
 */
export function Dialog({ title, onClose, children, actions, closeLabel: closeLabelProp, size = 'm', closeOnBackdrop = true, seeThroughWhileSliding = false }: DialogProps) {
  const { t } = useTranslation('common')
  const closeLabel = closeLabelProp ?? t('actions.done')
  useBackHandler(onClose)
  // Only a tap that also started on the backdrop closes: a press in a field that ends beside the
  // dialog - or one the dialog moved away from when the keyboard went down - is not "beside it".
  const pressedBackdrop = useRef(false)
  const typing = useTypingOnTouch()
  // Phone in landscape (under 300 px of height in the browser): no title row - the dialog keeps
  // its name for screen readers - and slimmer rows, so the content gets the height.
  const low = useMediaQuery(LOW_SCREEN)
  // The area the user can see (like DialogHost): where the browser or the app's WebView shrinks it
  // for the keyboard, the dialog fits into what is left and needs no cap of its own. Only where
  // typing shrinks nothing (the keyboard laid over the page unannounced) the 38 % cap stays.
  const visible = useSettledVisualViewport()
  const keyboardShown = useSettledTouchKeyboardOpen()
  // Decided only once the keyboard had time to come up: capping at once and growing again when the
  // area shrank drew the dialog twice - small at the top, then full (Redmi app, 2026-10-28).
  const [keyboardSettled, setKeyboardSettled] = useState(false)
  useEffect(() => {
    if (!typing.active) {
      setKeyboardSettled(false)
      return
    }
    const id = setTimeout(() => setKeyboardSettled(true), KEYBOARD_SETTLE_MS)
    return () => clearTimeout(id)
  }, [typing.active])
  const capForKeyboard = typing.active && keyboardSettled && !keyboardShown
  const [sliding, setSliding] = useState(false)
  useEffect(() => {
    if (!sliding) return
    const stop = () => setSliding(false)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
    return () => {
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
    }
  }, [sliding])
  return createPortal(
    // Dialogs are set-up, not stage (docs/15 D10): the Vorbereitung tier inside.
    <PrepTier>
      {/* h-dvh like DialogHost: the visible height, not the large viewport behind a browser's toolbar -
        with max-h-full below, the bottom row with "Fertig" could end up behind it (#432 review). */}
      <div
        className={`fixed inset-x-0 top-0 h-dvh z-dialog flex justify-center transition-colors sb-pad-safe ${sliding ? 'bg-transparent' : 'bg-scrim/60'} ${typing.active ? 'items-start' : 'items-center'}`}
        style={visible ? { top: visible.offsetTop, height: visible.height } : undefined}
        onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
        onClick={(e) => {
          if (closeOnBackdrop && pressedBackdrop.current && e.target === e.currentTarget) onClose()
          pressedBackdrop.current = false
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-typing={typing.active || undefined}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            typing.onPointerDown(e)
            if (seeThroughWhileSliding && e.target instanceof HTMLInputElement && e.target.type === 'range') setSliding(true)
          }}
          data-see-through={sliding || undefined}
          onFocus={typing.onFocus}
          onBlur={typing.onBlur}
          // While typing on a touchscreen the dialog moves up. Where the visible area shrank for the
          // keyboard, it takes all of what is left (the app on the Redmi, 2026-10-28: 686 of 1006 px -
          // the old fixed 38 % cap on top squeezed the cue dialog to a third of that). Where nothing
          // shrank, the browser laid the keyboard over the page without telling it (Fire Silk,
          // measured 2026-10-07: 333 of 686 px stay visible in landscape) - then at most 38 %.
          // Otherwise all the height the backdrop's safe padding leaves (max-h-full) - the Xiaomi in
          // landscape Chrome has only 513 px, and 90 % of it made the ☰ menu scroll.
          className={`flex ${capForKeyboard ? 'max-h-[38vh]' : 'max-h-full'} w-full ${WIDTH[size]} flex-col overflow-hidden border border-line bg-surface shadow-sb transition-opacity ${sliding ? 'opacity-25' : ''} ${CONTAINER}`}
        >
          <div className={low ? 'sr-only' : 'flex flex-shrink-0 items-center border-b border-line px-4 py-3'}>
            <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
          </div>
          <div className={`flex min-h-0 flex-col overflow-y-auto ${low ? 'gap-3 p-3' : 'gap-4 p-4'}`}>{children}</div>
          <div className={`flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line ${low ? 'px-3 py-1.5' : 'px-4 py-3'}`}>
            {actions ?? (
              <Button variant="primary" onClick={onClose} className="ml-auto">
                {closeLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </PrepTier>,
    document.body,
  )
}

/** How long the on-screen keyboard gets to shrink the visible area before the dialog caps itself. */
export const KEYBOARD_SETTLE_MS = 600

const TEXT_INPUT = /^(text|search|email|url|tel|password|number|time|date|datetime-local)$/

/** True while a text field inside the dialog has focus on a touch device after a tap on it (= the
 * on-screen keyboard is up). A field focused by `autoFocus` alone doesn't count: Android opens the
 * keyboard only on a real tap, and shrinking for nothing hid "Neue Setlist"'s song list (Fire,
 * 2026-10-07). */
function useTypingOnTouch() {
  const [active, setActive] = useState(false)
  const tapped = useRef(false)
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const isText = (el: EventTarget | null) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT.test(el.type))
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

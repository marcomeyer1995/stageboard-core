import type { PointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useSettledTouchKeyboardOpen } from '../lib/useTouchKeyboardOpen'
import { useSettledVisualViewport } from '../lib/useVisualViewport'
import { useTranslation } from 'react-i18next'

/** The four characters ChordPro needs that phone keyboards hide behind a symbol page (#606). */
export const CHORDPRO_KEYS = ['[', ']', '/', '|'] as const

/** Keeps the focus (and so the keyboard) in the text field: a button that took the focus would
 * close the keyboard on every tap. */
const keepFocus = (event: PointerEvent) => event.preventDefault()

function Key({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={keepFocus}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      // docs/15 D10 Vorbereitung: 40 px to see, 48 px to hit - the hit areas touch, so the keys
      // stand 8 px apart.
      className="flex h-form min-w-touch flex-shrink-0 items-center justify-center px-1"
    >
      <span className="flex h-prep min-w-[var(--sb-h-prep)] items-center justify-center rounded-control bg-control-strong px-3 font-sb-mono text-lg font-semibold text-ink">
        {children}
      </span>
    </button>
  )
}

interface ChordProKeyBarProps {
  /** The ChordPro text field has the focus. */
  active: boolean
  /** Up to five chords this song already uses, most used first. */
  chords: string[]
  onKey: (key: (typeof CHORDPRO_KEYS)[number]) => void
  onChord: (chord: string) => void
  onInsertMenu: () => void
}

/**
 * A row of ChordPro keys right above the on-screen keyboard while the song text is edited on a
 * touchscreen (#606): `[ ] / |`, the song's own chords as one-tap inserts, and "+ Einfügen".
 * Placed from the visual viewport - the part of the page the keyboard leaves visible - so it sits
 * on the keyboard in the app and in the browser alike, and is gone when the keyboard closes.
 */
export function ChordProKeyBar({ active, chords, onKey, onChord, onInsertMenu }: ChordProKeyBarProps) {
  const { t } = useTranslation('editor')
  // Settled: the WebView's brief wrong height while the keyboard comes up must not place the bar.
  const visible = useSettledVisualViewport()
  const keyboardOpen = useSettledTouchKeyboardOpen()
  if (!active || !keyboardOpen || !visible) return null

  return createPortal(
    <div
      role="toolbar"
      aria-label={t('keys.aria')}
      style={{ top: visible.offsetTop + visible.height }}
      className="fixed inset-x-0 z-menu flex -translate-y-full items-center overflow-x-auto border-t border-line bg-surface px-2"
    >
      {CHORDPRO_KEYS.map((key) => (
        <Key key={key} label={key} onPress={() => onKey(key)}>
          {key}
        </Key>
      ))}
      {chords.length > 0 && <span aria-hidden="true" className="mx-1 h-6 w-px flex-shrink-0 bg-line" />}
      {chords.map((chord) => (
        <Key key={chord} label={t('keys.chord', { chord })} onPress={() => onChord(chord)}>
          <span className="text-accent">{chord}</span>
        </Key>
      ))}
      <span className="flex-1" />
      <Key label={t('keys.insert')} onPress={onInsertMenu}>
        +
      </Key>
    </div>,
    document.body,
  )
}

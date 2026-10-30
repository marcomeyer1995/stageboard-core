import i18n from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseChordSymbol } from '../lib/chordSymbol'
import { guitarShapesFor } from '../lib/guitarShapes'
import { GuitarShapePicker } from './GuitarShapePicker'
import { PianoChordDiagram } from './PianoChordDiagram'

/** Gap to the screen edge and to the chord. */
const EDGE_PX = 12
const MAX_WIDTH_PX = 360

/**
 * A tapped chord's shape (#609): guitar box and piano keys in a bubble beside the chord, from the
 * same drawings as the chord reference widget. Placed below the chord, above when there's no room,
 * always fully on screen (a chord at the edge of a 360 px phone too); a tap outside, scrolling or
 * Esc closes it.
 */
export function ChordPopover({ symbol, anchor, onClose }: { symbol: string; anchor: DOMRect; onClose: () => void }) {
  const bubble = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null)
  const info = parseChordSymbol(symbol)
  const shapes = info?.qualityId ? guitarShapesFor(info.rootPitchClass, info.qualityId) : []

  useLayoutEffect(() => {
    const width = Math.min(MAX_WIDTH_PX, window.innerWidth - 2 * EDGE_PX)
    const left = Math.min(Math.max(EDGE_PX, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - EDGE_PX - width)
    const height = bubble.current?.offsetHeight ?? 0
    const below = anchor.bottom + EDGE_PX / 2
    const fitsBelow = below + height <= window.innerHeight - EDGE_PX
    const top = fitsBelow ? below : Math.max(EDGE_PX, anchor.top - EDGE_PX / 2 - height)
    setPlace({ top, left, width })
  }, [anchor])

  useEffect(() => {
    const close = (e: Event) => {
      if (e.target instanceof Node && bubble.current?.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Added after the gesture that opened it, so that same pointer never closes it again.
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', close, true), 0)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={bubble}
      role="dialog"
      aria-label={`Akkord ${symbol}`}
      className="fixed z-alert flex flex-col gap-3 rounded-container border border-line bg-surface p-4 text-ink shadow-sb"
      style={place ? { top: place.top, left: place.left, width: place.width } : { top: 0, left: 0, width: MAX_WIDTH_PX, visibility: 'hidden' }}
    >
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold">{symbol}</span>
        {info && <span className="font-sb-mono text-base text-ink-soft">{info.notes.join(' ')}</span>}
      </div>
      {info ? (
        <div className="flex flex-wrap items-start gap-4">
          {shapes.length > 0 ? (
            <GuitarShapePicker shapes={shapes} />
          ) : (
            <span className="text-base text-ink-faint">{i18n.t('common:ui.noShape')}</span>
          )}
          <div className="w-56 max-w-full">
            <PianoChordDiagram rootPitchClass={info.rootPitchClass} semitones={info.semitones} />
          </div>
          {info.bass && <span className="text-base text-ink-soft">Bass: {info.bass}</span>}
        </div>
      ) : (
        <span className="text-base text-ink-faint">Unbekannter Akkord</span>
      )}
    </div>,
    document.body,
  )
}

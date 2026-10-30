import { useRef, useState, type PointerEvent } from 'react'
import type { GuitarShape } from '../lib/guitarShapes'
import { GuitarChordDiagram } from './GuitarChordDiagram'
import { IconButton } from './ui'
import { useTranslation } from 'react-i18next'

/** How far a finger must move sideways to switch to the next shape, CSS px. */
const SWIPE_PX = 40

/**
 * The guitar shapes of one chord, one at a time (#609, Marco 2026-10-28: a chord is played in
 * several places on the neck): swipe sideways or tap ‹ › to move through them, low to high.
 */
export function GuitarShapePicker({ shapes }: { shapes: readonly GuitarShape[] }) {
  const { t } = useTranslation('editor')
  const [index, setIndex] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const shape = shapes[Math.min(index, shapes.length - 1)]
  if (!shape) return null
  const step = (by: number) => setIndex((i) => Math.min(shapes.length - 1, Math.max(0, i + by)))
  const many = shapes.length > 1
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-36 touch-pan-y"
        onPointerDown={(e: PointerEvent) => (start.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e: PointerEvent) => {
          const from = start.current
          start.current = null
          if (!from || !many) return
          const dx = e.clientX - from.x
          if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - from.y)) step(dx < 0 ? 1 : -1)
        }}
      >
        <GuitarChordDiagram shape={shape} />
      </div>
      {many && (
        <div className="flex items-center gap-1">
          <IconButton icon="previous" label={t('shape.lower')} variant="quiet" disabled={index === 0} onClick={() => step(-1)} />
          <span className="min-w-16 text-center text-base tabular-nums text-ink-soft">
            {index + 1}/{shapes.length}
          </span>
          <IconButton icon="next" label={t('shape.higher')} variant="quiet" disabled={index === shapes.length - 1} onClick={() => step(1)} />
        </div>
      )}
    </div>
  )
}

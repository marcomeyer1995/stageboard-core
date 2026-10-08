import { useEffect, useRef } from 'react'
import { minimapGrab, minimapTime, minimapX, PART_FILL, tokenColor, type MinimapRange, type TimelineView } from '../../lib/timeline'
import type { PartBlock } from '../../lib/timelineText'
import type { WaveformPeaks } from '../../lib/waveformPeaks'

/** Touch-sized (48 px), like every control on stage. */
export const MINIMAP_H = 48

interface TimelineMinimapProps {
  /** Strip width = the lanes' width, px. */
  width: number
  peaks: WaveformPeaks | null
  /** The whole song, count-in to end. */
  range: MinimapRange
  view: TimelineView
  /** How much song the lanes show at the current zoom, ms. */
  viewSpanMs: number
  blocks: readonly PartBlock[]
  playheadMs: number
  /** Scroll the lanes so they start at `startMs` (the zoom stays). */
  onPan: (startMs: number) => void
}

function cssVar(name: string, fallback: string): string {
  return tokenColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

/**
 * Overview of the whole track above the lanes (#327): the waveform from count-in to end, the part
 * blocks as bands, the playhead, and a box for the part the lanes currently show. Tapping the strip
 * centres the lanes there, dragging the box scrolls them - always at the current zoom.
 */
export function TimelineMinimap({ width, peaks, range, view, viewSpanMs, blocks, playheadMs, onPan }: TimelineMinimapProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const grab = useRef<{ pointerId: number; grabMs: number } | null>(null)

  useEffect(() => {
    const c = canvas.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = MINIMAP_H * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, MINIMAP_H)
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')

    blocks.forEach((block, i) => {
      const x0 = minimapX(block.startMs, range, width)
      const x1 = minimapX(block.endMs, range, width)
      g.fillStyle = PART_FILL[i % 2]!
      g.fillRect(x0, MINIMAP_H - 8, Math.max(1, x1 - x0 - 1), 8)
    })

    if (peaks) {
      const { min, max, bucketMs } = peaks
      const mid = (MINIMAP_H - 8) / 2
      g.fillStyle = faint
      for (let x = 0; x < width; x++) {
        const from = Math.floor(((x / width) * (range.toMs - range.fromMs) + range.fromMs) / bucketMs)
        const to = Math.max(from + 1, Math.floor((((x + 1) / width) * (range.toMs - range.fromMs) + range.fromMs) / bucketMs))
        let lo = 0
        let hi = 0
        for (let b = Math.max(0, from); b < Math.min(min.length, to); b++) {
          if (min[b]! < lo) lo = min[b]!
          if (max[b]! > hi) hi = max[b]!
        }
        if (hi > lo) g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid))
      }
    }

    const px = minimapX(playheadMs, range, width)
    g.fillStyle = cssVar('--sb-danger', '#ef4444')
    g.fillRect(px - 1, 0, 2, MINIMAP_H)

    const bx = Math.max(0, minimapX(view.startMs, range, width))
    const bw = Math.min(width, minimapX(view.startMs + viewSpanMs, range, width)) - bx
    g.fillStyle = 'rgba(245,158,11,0.18)'
    g.fillRect(bx, 0, bw, MINIMAP_H)
    g.strokeStyle = accent
    g.lineWidth = 2
    g.strokeRect(bx + 1, 1, Math.max(2, bw - 2), MINIMAP_H - 2)
  }, [width, peaks, range, view, viewSpanMs, blocks, playheadMs])

  function x(e: React.PointerEvent<HTMLCanvasElement>): number {
    return e.clientX - e.currentTarget.getBoundingClientRect().left
  }

  return (
    <canvas
      ref={canvas}
      className="w-full rounded-control border border-line bg-stage"
      style={{ height: MINIMAP_H, touchAction: 'none' }}
      aria-label="Übersicht"
      data-testid="timeline-minimap"
      onPointerDown={(e) => {
        const hit = minimapGrab(x(e), range, width, view, viewSpanMs)
        grab.current = { pointerId: e.pointerId, grabMs: hit.grabMs }
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // Synthetic events (tests) have no capturable pointer - dragging still works inside the strip.
        }
        onPan(hit.startMs)
      }}
      onPointerMove={(e) => {
        if (grab.current?.pointerId !== e.pointerId) return
        onPan(minimapTime(x(e), range, width) - grab.current.grabMs)
      }}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
    />
  )
}

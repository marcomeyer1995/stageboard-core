import i18n from '../../i18n'
import { useEffect, useRef, type PointerEvent } from 'react'
import type { TrackMeta } from 'shared-types'
import { timeToX, tokenColor, xToTime, type TimelineView } from '../../lib/timeline'
import type { TrackAnalysis } from '../../lib/trackAnalysis'
import { STEM_ROLE_LABELS } from '../../lib/stems'
import { Icon } from '../Icon'

/** One stem lane: touch-sized, like every control on stage. */
export const STEM_LANE_H = 48

/** This many stem lanes are visible; more scroll inside the block - any number of stems fits
 * without pushing the timeline's own lanes together (2026-10-16). */
const VISIBLE_LANES = 2.5

/** Height of the opened stems block under the waveform. */
export function stemsBlockHeight(count: number): number {
  return Math.min(count, VISIBLE_LANES) * STEM_LANE_H
}

function cssVar(name: string, fallback: string): string {
  return tokenColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

/** A touch on the stems neither scrolls the timeline nor moves the playhead. */
const stopPointer = (e: PointerEvent) => e.stopPropagation()

interface StemsToggleProps {
  count: number
  open: boolean
  /** px from the top of the lanes. */
  top: number
  onToggle: () => void
  /** The stem heard alone, or null = the mix. */
  soloLabel: string | null
  /** The stem the red/green marks and the magnet take their hits from (chosen at "Track
   * analysieren"), or null = the mix. */
  analysisSourceLabel: string | null
}

/** ▸ Stems (n) on the waveform's bottom left - collapsed stems take no space (docs/22 §5). */
export function StemsToggle({ count, open, top, onToggle, soloLabel, analysisSourceLabel }: StemsToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      onPointerDown={stopPointer}
      aria-expanded={open}
      className="absolute left-1 z-content flex min-h-form items-center gap-2 rounded-control bg-control/80 px-2 text-base text-ink [@media(hover:hover)]:hover:bg-control"
      style={{ top }}
    >
      <Icon name={open ? 'collapse' : 'expand'} />
      {i18n.t('editor:tl.stems', { count })}
      {soloLabel ? i18n.t('editor:tl.onlySolo', { name: soloLabel }) : ''}
      {analysisSourceLabel ? i18n.t('editor:tl.hitsFrom', { name: analysisSourceLabel }) : ''}
    </button>
  )
}

interface TimelineStemsProps {
  stems: readonly TrackMeta[]
  /** Each stem's waveform, once analysed (by stem id). */
  analyses: ReadonlyMap<string, TrackAnalysis>
  /** Where the block sits in the lanes (right under the waveform) and its height, px. */
  top: number
  height: number
  /** Lane width = the timeline's width, px. */
  width: number
  view: TimelineView
  playheadMs: number
  /** The stem heard alone, or null = the mix. */
  soloId: string | null
  onSolo: (stemId: string | null) => void
}

/**
 * The opened stems right under the waveform (docs/22 §5; collapsed by default, the waveform stays
 * the mix): one narrow waveform per stem, on the same zoom, scroll position and playhead. Tapping
 * a stem plays only that stem (tap again: the mix) - to lay a bar line or a cue onto a hit, e.g.
 * drums only. Swiping here scrolls the stems up and down, not the timeline.
 */
export function TimelineStems({ stems, analyses, top, height, width, view, playheadMs, soloId, onSolo }: TimelineStemsProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const lanesH = stems.length * STEM_LANE_H

  useEffect(() => {
    const c = canvas.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = lanesH * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, lanesH)
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')
    const line = cssVar('--sb-line', '#404040')
    stems.forEach((stem, i) => {
      const laneTop = i * STEM_LANE_H
      if (i > 0) {
        g.fillStyle = line
        g.fillRect(0, laneTop, width, 1)
      }
      const analysis = analyses.get(stem.id)
      if (!analysis) return
      const { min, max, bucketMs } = analysis.peaks
      const mid = laneTop + STEM_LANE_H / 2
      const half = STEM_LANE_H / 2 - 2
      g.fillStyle = soloId === stem.id ? accent : faint
      for (let x = 0; x < width; x++) {
        const from = Math.floor(xToTime(x, view) / bucketMs)
        const to = Math.max(from + 1, Math.floor(xToTime(x + 1, view) / bucketMs))
        let lo = 0
        let hi = 0
        for (let b = Math.max(0, from); b < Math.min(min.length, to); b++) {
          if (min[b]! < lo) lo = min[b]!
          if (max[b]! > hi) hi = max[b]!
        }
        if (hi > lo) g.fillRect(x, mid - hi * half, 1, Math.max(1, (hi - lo) * half))
      }
    })
  }, [stems, analyses, width, lanesH, view, soloId])

  const playheadX = timeToX(playheadMs, view)

  return (
    <div
      className="absolute left-0 w-full overflow-y-auto overflow-x-hidden border-y border-line bg-stage"
      style={{ top, height, touchAction: 'pan-y' }}
      onPointerDown={stopPointer}
      data-testid="timeline-stem-lanes"
    >
      <div className="relative w-full" style={{ height: lanesH }}>
        <canvas ref={canvas} className="absolute left-0 top-0" style={{ width, height: lanesH }} />
        {stems.map((stem, i) => {
          const solo = soloId === stem.id
          return (
            <button
              key={stem.id}
              type="button"
              aria-pressed={solo}
              title={solo ? i18n.t('editor:tl.allStems') : i18n.t('editor:tl.onlyStem', { name: stem.label })}
              onClick={() => onSolo(solo ? null : stem.id)}
              className="absolute left-0 flex w-full items-start"
              style={{ top: i * STEM_LANE_H, height: STEM_LANE_H }}
            >
              <span className={`m-1 rounded-control px-2 py-0.5 text-sm font-semibold ${solo ? 'bg-accent text-accent-ink' : 'bg-control/80 text-ink'}`}>
                {stem.label}
                {stem.role && stem.role !== 'other' && STEM_ROLE_LABELS[stem.role] !== stem.label ? ` · ${STEM_ROLE_LABELS[stem.role]}` : ''}
                {solo ? ' · solo' : ''}
              </span>
            </button>
          )
        })}
        {playheadX >= 0 && playheadX <= width && <div className="pointer-events-none absolute left-0 top-0 h-full w-0.5 bg-danger will-change-transform" style={{ transform: `translateX(${playheadX}px)` }} />}
      </div>
    </div>
  )
}

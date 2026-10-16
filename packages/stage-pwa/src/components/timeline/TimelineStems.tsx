import { useEffect, useRef } from 'react'
import type { TrackMeta } from 'shared-types'
import { timeToX, tokenColor, xToTime, type TimelineView } from '../../lib/timeline'
import type { TrackAnalysis } from '../../lib/trackAnalysis'
import { STEM_ROLE_LABELS } from '../../lib/stems'
import { Icon } from '../Icon'
import { Segmented } from '../ui'

/** One stem lane: touch-sized, like every control on stage. */
export const STEM_LANE_H = 48

function cssVar(name: string, fallback: string): string {
  return tokenColor(getComputedStyle(document.documentElement).getPropertyValue(name), fallback)
}

interface TimelineStemsProps {
  stems: readonly TrackMeta[]
  /** Each stem's waveform, once analysed (by stem id). */
  analyses: ReadonlyMap<string, TrackAnalysis>
  open: boolean
  onToggle: () => void
  /** Lane width = the timeline's width, px. */
  width: number
  view: TimelineView
  playheadMs: number
  /** The stem heard alone, or null = the mix. */
  soloId: string | null
  onSolo: (stemId: string | null) => void
  /** Where "Track analysieren" and the red/green marks take their hits from: a stem, or null = the mix. */
  analysisSourceId: string | null
  onAnalysisSource: (stemId: string | null) => void
  /** Phone: the lanes scroll inside a capped height (they pushed the timeline's own lanes
   * together, 2026-10-16) and the analysis source sits in the tools panel instead. */
  compact?: boolean
}

/** The phone shows this many stem lanes; more scroll. */
const COMPACT_VISIBLE_LANES = 2.5

/** "Treffer für die Analyse aus" - under the stems, or in the timeline's tools panel on the phone. */
export function StemSourcePicker({ stems, analysisSourceId, onAnalysisSource }: Pick<TimelineStemsProps, 'stems' | 'analysisSourceId' | 'onAnalysisSource'>) {
  const options = [{ value: '', label: 'Mix' }, ...stems.map((s) => ({ value: s.id, label: s.label }))]
  return (
    <Segmented
      label="Treffer für die Analyse aus"
      showLabel
      compact={options.length >= 4}
      value={analysisSourceId ?? ''}
      onChange={(value) => onAnalysisSource(value === '' ? null : value)}
      options={options}
      hint="Rot/Grün und „Track analysieren“ - Mix ist meist zuverlässiger."
    />
  )
}

/**
 * The stems under the timeline (docs/22 §5): collapsed by default - the waveform above stays the
 * mix, as before - and opened with ▸ into one narrow waveform per stem, on the same zoom, scroll
 * position and playhead. Tapping a stem plays only that stem (tap again: the mix) - to lay a bar
 * line or a cue onto a hit, e.g. drums only. The hits the analysis uses can come from a stem
 * instead of the mix; the mix stays the default (docs/22 §5: the drum stem alone was worse).
 */
export function TimelineStems({ stems, analyses, open, onToggle, width, view, playheadMs, soloId, onSolo, analysisSourceId, onAnalysisSource, compact = false }: TimelineStemsProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const height = stems.length * STEM_LANE_H

  useEffect(() => {
    const c = canvas.current
    const g = c?.getContext('2d')
    if (!open || !c || !g) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = height * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    const faint = cssVar('--sb-ink-faint', '#a3a3a3')
    const accent = cssVar('--sb-accent', '#f59e0b')
    const line = cssVar('--sb-line', '#404040')
    stems.forEach((stem, i) => {
      const top = i * STEM_LANE_H
      if (i > 0) {
        g.fillStyle = line
        g.fillRect(0, top, width, 1)
      }
      const analysis = analyses.get(stem.id)
      if (!analysis) return
      const { min, max, bucketMs } = analysis.peaks
      const mid = top + STEM_LANE_H / 2
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
  }, [open, stems, analyses, width, height, view, soloId])

  const playheadX = timeToX(playheadMs, view)

  return (
    <div className="flex flex-col gap-1" data-testid="timeline-stems">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-form items-center gap-2 self-start rounded-control px-2 text-base text-ink-muted [@media(hover:hover)]:hover:bg-control"
      >
        <Icon name={open ? 'collapse' : 'expand'} />
        Stems ({stems.length}){soloId ? ` · nur ${stems.find((s) => s.id === soloId)?.label ?? ''}` : ''}
      </button>
      {open && (
        <>
          <div
            className="w-full overflow-y-auto overflow-x-hidden rounded-control border border-line bg-stage"
            style={{ maxHeight: compact ? COMPACT_VISIBLE_LANES * STEM_LANE_H : undefined }}
            data-testid="timeline-stem-lanes"
          >
            <div className="relative w-full" style={{ height }}>
              <canvas ref={canvas} className="absolute left-0 top-0" style={{ width, height }} />
              {stems.map((stem, i) => {
                const solo = soloId === stem.id
                return (
                  <button
                    key={stem.id}
                    type="button"
                    aria-pressed={solo}
                    title={solo ? 'Wieder alle Spuren hören' : `Nur ${stem.label} hören`}
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
              {playheadX >= 0 && playheadX <= width && <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-danger" style={{ left: playheadX }} />}
            </div>
          </div>
          {!compact && <StemSourcePicker stems={stems} analysisSourceId={analysisSourceId} onAnalysisSource={onAnalysisSource} />}
        </>
      )}
    </div>
  )
}

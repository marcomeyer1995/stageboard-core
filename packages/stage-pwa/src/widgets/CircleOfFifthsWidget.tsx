import { useState } from 'react'
import {
  circleLabel,
  describeSignature,
  keyName,
  keyRelations,
  wedgeCentre,
  wedgePath,
  type CircleKey,
} from '../lib/circleOfFifths'
import { CIRCLE_VIEWBOX, circleLabelUnits } from '../lib/stageWidgetLayout'
import { useElementSize } from '../lib/useElementSize'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type CircleOfFifthsConfig } from './circleOfFifthsConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'

const CENTRE = 100
const RING_RADII = { major: { inner: 66, outer: 96 }, minor: { inner: 38, outer: 64 } } as const

type Role = 'selected' | 'relative' | 'neighbour' | 'none'

const WEDGE_STYLE: Record<Role, { fill: string; text: string }> = {
  selected: { fill: 'fill-accent', text: 'fill-accent-ink' },
  relative: { fill: 'fill-accent-2', text: 'fill-accent-ink' },
  neighbour: { fill: 'fill-control-strong', text: 'fill-ink' },
  none: { fill: 'fill-control', text: 'fill-ink-soft' },
}

/**
 * Interactive Circle of Fifths (#24). Tap a slice on either ring: it lights up, together with
 * its Paralleltonart (the relative major/minor on the other ring, sharing the key signature) and
 * the Dominante and Subdominante next to it. The readout underneath spells the relations out.
 * All computed locally (circleOfFifths.ts); the selection is the widget's own transient state.
 *
 * The circle fills the space the readout leaves (beside it in a wide tile, above it otherwise)
 * and its labels are sized in SVG units for the drawn size, so they render at the 16px stage
 * floor (they were 11-14px at the old 4 x 7 default, GUI audit 2026-09-27).
 */
export function CircleOfFifthsWidget({ config }: { config: CircleOfFifthsConfig }) {
  const naming = config.noteNaming ?? 'sharp'
  const [selected, setSelected] = useState<CircleKey>({ ring: 'major', index: 0 })
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))
  const relations = keyRelations(selected)
  const [rootRef, root] = useElementSize()
  const [circleRef, circle] = useElementSize()
  const beside = root.width > 0 && root.width >= root.height * 1.3
  const labelUnits = circleLabelUnits(Math.min(circle.width, circle.height))

  const roleOf = (key: CircleKey): Role => {
    const same = (other: CircleKey) => other.ring === key.ring && other.index === key.index
    if (same(relations.selected)) return 'selected'
    if (same(relations.relative)) return 'relative'
    if (same(relations.dominant) || same(relations.subdominant)) return 'neighbour'
    return 'none'
  }

  return (
    <div
      ref={rootRef}
      className={`flex h-full items-center gap-2 overflow-hidden text-ink-soft ${beside ? 'flex-row' : 'flex-col'}`}
    >
      <div ref={circleRef} className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center">
        <svg viewBox={`0 0 ${CIRCLE_VIEWBOX} ${CIRCLE_VIEWBOX}`} role="group" aria-label="Quintenzirkel" className="h-full w-full">
          {(['major', 'minor'] as const).flatMap((ring) =>
            Array.from({ length: 12 }, (_, index) => {
              const key: CircleKey = { ring, index }
              const style = WEDGE_STYLE[roleOf(key)]
              const radii = RING_RADII[ring]
              const label = circleLabel(key, naming)
              const centre = wedgeCentre(CENTRE, CENTRE, (radii.inner + radii.outer) / 2, index)
              return (
                <g key={`${ring}-${index}`} role="button" tabIndex={0} aria-label={label} aria-pressed={roleOf(key) === 'selected'} className="cursor-pointer"
                  onClick={() => setSelected(key)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(key)}
                >
                  <path d={wedgePath(CENTRE, CENTRE, radii.inner, radii.outer, index)} className={`${style.fill} stroke-ink-faint`} strokeWidth={0.8} />
                  <text x={centre.x} y={centre.y} textAnchor="middle" dominantBaseline="central" fontSize={labelUnits[ring]} fontWeight={700} className={`pointer-events-none ${style.text}`}>
                    {label}
                  </text>
                </g>
              )
            }),
          )}
        </svg>
      </div>

      <div
        style={{ fontSize }}
        className={`flex flex-shrink-0 flex-col items-center gap-0.5 text-center ${beside ? 'max-w-[45%]' : ''}`}
      >
        <span className="font-bold text-ink">{keyName(relations.selected, naming)}</span>
        <span className="text-[length:max(var(--sb-text-min),0.7em)] text-ink-muted">
          Paralleltonart: <span className="font-semibold text-ink">{keyName(relations.relative, naming)}</span>
        </span>
        <span className="text-[length:max(var(--sb-text-min),0.7em)] text-ink-muted">
          Dominante: <span className="font-semibold text-ink">{circleLabel(relations.dominant, naming)}</span>
          {' · '}
          Subdominante: <span className="font-semibold text-ink">{circleLabel(relations.subdominant, naming)}</span>
        </span>
        <span className="text-[length:max(var(--sb-text-min),0.7em)] text-ink-faint">{describeSignature(relations.selected.index, naming)}</span>
      </div>
    </div>
  )
}

export function CircleOfFifthsConfigPanel({
  config,
  onChange,
}: {
  config: CircleOfFifthsConfig
  onChange: (next: CircleOfFifthsConfig) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Notenname
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.noteNaming ?? 'sharp'}
          onChange={(e) => onChange({ ...config, noteNaming: e.target.value as CircleOfFifthsConfig['noteNaming'] })}
        >
          <option value="sharp">Kreuz (F#)</option>
          <option value="flat">B (Gb)</option>
        </select>
      </label>
      <SizeRatioSlider label="Beschreibung" ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO} onChange={(sizeRatio) => onChange({ ...config, sizeRatio })} />
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MatrixPoint, SignalClass } from 'shared-types'

export interface MatrixLine {
  key: string
  label: string
  point: MatrixPoint
  /** Channels this source carries (a stereo track: 2) - how many free lines it takes when dropped
   * on a closed group. Columns only. */
  width?: number
  /** The group this line belongs to (docs/31 §7c, #744): a channel group ("Eingang 1–16"), a
   * container's part ("USB-C · Audio aus 1–4") or a socket's pins ("Kopfhörer", L, R). Closed
   * until opened; a closed group is one line. */
  group?: MatrixGroup
  /** The signal classes it carries (Ton, MIDI, Licht). A crosspoint is only offered where a
   * column and a row share one - no MIDI onto an audio output (device test 2026-11-12). */
  classes?: readonly SignalClass[]
}

export interface MatrixGroup {
  key: string
  label: string
  /** What a tap on the closed group means, when it has a meaning of its own: the whole socket for
   * a pins group, the whole signal for a stereo source. Without one, a tap takes the next free
   * lines of the group (smart assignment). */
  closedPoint?: MatrixPoint
  /** A source group closed: as wide as the signal (the track: 2) when it lands on a closed group. */
  width?: number
  /** False: the closed group shows its name only, no "routed/total" (a source's sides). */
  count?: boolean
}

/** A row or column as drawn: one line, or a closed group standing for its lines. */
type Drawn = { kind: 'line'; line: MatrixLine; group?: MatrixGroup } | { kind: 'group'; group: MatrixGroup; lines: MatrixLine[] }

const CELL = 48
const HEADER = 120

/** Lines with their groups folded where the group is closed - the order stays. */
function fold(lines: MatrixLine[], open: ReadonlySet<string>): Drawn[] {
  const out: Drawn[] = []
  for (const line of lines) {
    const group = line.group
    if (!group) {
      out.push({ kind: 'line', line })
      continue
    }
    if (open.has(group.key)) {
      out.push({ kind: 'line', line, group })
      continue
    }
    const last = out[out.length - 1]
    if (last?.kind === 'group' && last.group.key === group.key) last.lines.push(line)
    else out.push({ kind: 'group', group, lines: [line] })
  }
  return out
}

/**
 * A device's routing matrix (Marco, 2026-11-06): inputs are the columns, outputs the rows - their
 * names fixed on the right, "output means right". A routed cell draws the signal: down from its
 * input, at the cell turning right towards the output, like a patchbay. Fixed routing is drawn
 * greyed and cannot be tapped. On the phone the grid scrolls sideways, the outputs stay.
 *
 * Smart matrix (docs/31 §7c, #744): channel groups and container parts are closed until opened -
 * a closed group is one row or column that shows how much is routed inside it. A tap on a closed
 * group takes the next free lines matching the source's width (a stereo track: two adjacent),
 * or clears what the source has in it; a pins group tapped closed routes the whole socket. Only
 * open groups are drawn, so 32 × 32 stays usable on a phone.
 */
export function RoutingMatrix({
  columns,
  rows,
  routed,
  fixed,
  editable,
  onToggle,
  label,
  badge,
}: {
  columns: MatrixLine[]
  rows: MatrixLine[]
  routed: (from: MatrixPoint, to: MatrixPoint) => boolean
  /** A letter in a routed cell: which side of a stereo source sits there ("L", "R"). */
  badge?: (from: MatrixPoint, to: MatrixPoint) => string | undefined
  fixed: boolean
  editable: boolean
  onToggle: (from: MatrixPoint, to: MatrixPoint, on: boolean) => void
  label: string
}) {
  const { t } = useTranslation('hardware')
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const toggleGroup = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const cols = fold(columns, open)
  const rws = fold(rows, open)
  const width = cols.length * CELL + CELL / 2
  const height = HEADER + rws.length * CELL
  const cx = (c: number) => c * CELL + CELL / 2
  const cy = (r: number) => HEADER + r * CELL + CELL / 2
  const lineClass = fixed ? 'stroke-ink-faint' : 'stroke-accent'
  const dotClass = fixed ? 'fill-ink-faint' : 'fill-accent'
  const canTap = editable && !fixed

  // What a drawn row or column stands for when asked "is this routed".
  const linesOf = (d: Drawn): MatrixLine[] => (d.kind === 'line' ? [d.line] : d.lines)
  // Absent classes: anything goes (lines that do not say).
  const fits = (col: Drawn, row: Drawn) =>
    linesOf(col).some((c) => linesOf(row).some((r) => !c.classes || !r.classes || c.classes.some((x) => r.classes!.includes(x))))
  const isRouted = (col: Drawn, row: Drawn) => linesOf(col).some((c) => linesOf(row).some((r) => routed(c.point, r.point)))
  const routedCount = (d: Drawn, others: Drawn[], asColumn: boolean) =>
    linesOf(d).filter((l) => others.some((o) => linesOf(o).some((x) => (asColumn ? routed(l.point, x.point) : routed(x.point, l.point))))).length
  const labelOf = (d: Drawn, others: Drawn[], asColumn: boolean) => {
    if (d.kind === 'line') return d.line.label
    if (d.group.count === false) return d.group.label
    // A pins group counts its pins (a headphone socket 2, not 3): the line for the whole socket
    // fills all of them.
    const closed = d.group.closedPoint
    const wholeLine = closed ? d.lines.find((l) => JSON.stringify(l.point) === JSON.stringify(closed)) : undefined
    if (!wholeLine) return `${d.group.label} · ${routedCount(d, others, asColumn)}/${d.lines.length}`
    const pins: Drawn = { ...d, lines: d.lines.filter((l) => l !== wholeLine) }
    const whole = routedCount({ kind: 'line', line: wholeLine }, others, asColumn) > 0
    return `${d.group.label} · ${whole ? pins.lines.length : routedCount(pins, others, asColumn)}/${pins.lines.length}`
  }

  // The letter in a routed cell: the first routed pair inside it that has one.
  const badgeOf = (col: Drawn, row: Drawn): string | undefined => {
    if (!badge) return undefined
    for (const c of linesOf(col)) for (const r of linesOf(row)) if (routed(c.point, r.point)) {
      const text = badge(c.point, r.point)
      if (text) return text
    }
    return undefined
  }

  // A closed group that stands for one point of its own (a stereo socket, a stereo source) taps
  // like that one line.
  const asLine = (d: Drawn): Drawn =>
    d.kind === 'group' && d.group.closedPoint ? { kind: 'line', line: { key: d.group.key, label: d.group.label, point: d.group.closedPoint, ...(d.group.width ? { width: d.group.width } : {}) } } : d

  // A tap: both single lines toggle the cell; a closed group assigns or clears (docs/31 §7c).
  const tap = (tappedCol: Drawn, tappedRow: Drawn) => {
    const col = asLine(tappedCol)
    const row = asLine(tappedRow)
    if (col.kind === 'line' && row.kind === 'line') return onToggle(col.line.point, row.line.point, !routed(col.line.point, row.line.point))
    if (col.kind === 'group' && row.kind === 'group') {
      // Two closed groups: nothing to guess - open both.
      setOpen((prev) => new Set([...prev, col.group.key, row.group.key]))
      return
    }
    const fromCol = col.kind === 'line'
    const source = col.kind === 'line' ? col.line : (row as { kind: 'line'; line: MatrixLine }).line
    const target = (col.kind === 'group' ? col : row) as { kind: 'group'; group: MatrixGroup; lines: MatrixLine[] }
    const on = (a: MatrixLine, b: MatrixLine, value: boolean) => (fromCol ? onToggle(a.point, b.point, value) : onToggle(b.point, a.point, value))
    const has = (a: MatrixLine, b: MatrixLine) => (fromCol ? routed(a.point, b.point) : routed(b.point, a.point))
    const mine = target.lines.filter((l) => has(source, l))
    if (mine.length > 0) return mine.forEach((l) => on(source, l, false))
    // The next free lines of the group, as many as the source is wide, adjacent.
    const others = fromCol ? columns : rows
    const free = target.lines.map((l) => !others.some((o) => (fromCol ? routed(o.point, l.point) : routed(l.point, o.point))))
    const need = fromCol ? (source.width ?? 1) : 1
    for (let i = 0; i + need <= target.lines.length; i++) {
      if (free.slice(i, i + need).every(Boolean)) {
        target.lines.slice(i, i + need).forEach((l) => on(source, l, true))
        return
      }
    }
  }

  const groupToggle = (d: Drawn) => (d.kind === 'group' || d.group ? (d.kind === 'group' ? d.group : d.group!) : null)

  return (
    <div className="flex items-start" role="group" aria-label={label}>
      <div className="min-w-0 overflow-x-auto">
        <svg width={width} height={height} className="block">
          {cols.map((col, c) => {
            const group = groupToggle(col)
            const text = labelOf(col, rws, true)
            return group ? (
              <text
                key={col.kind === 'line' ? col.line.key : `g:${col.group.key}`}
                transform={`translate(${cx(c) + 5} ${HEADER - 8}) rotate(-60)`}
                className="cursor-pointer fill-ink-soft text-[16px]"
                role="button"
                aria-expanded={open.has(group.key)}
                aria-label={t('map.groupToggle', { name: group.label })}
                onClick={() => toggleGroup(group.key)}
              >
                {`${open.has(group.key) ? '▾ ' : '▸ '}${text}`}
              </text>
            ) : (
              <text key={col.kind === 'line' ? col.line.key : `g:${col.group.key}`} transform={`translate(${cx(c) + 5} ${HEADER - 8}) rotate(-60)`} className="fill-ink-soft text-[16px]">
                {text}
              </text>
            )
          })}
          {rws.map((row, r) => cols.map((col, c) => (fits(col, row) ? <circle key={`${r}|${c}`} cx={cx(c)} cy={cy(r)} r={3} className="fill-ink-faint" /> : null)))}
          {cols.map((col, c) => {
            const last = rws.reduce((max, row, r) => (isRouted(col, row) ? r : max), -1)
            return last < 0 ? (
              <line key={c} x1={cx(c)} y1={HEADER - 4} x2={cx(c)} y2={HEADER + 8} className="stroke-ink-faint" strokeWidth={3} />
            ) : (
              <line key={c} x1={cx(c)} y1={HEADER - 4} x2={cx(c)} y2={cy(last)} className={lineClass} strokeWidth={3} />
            )
          })}
          {rws.map((row, r) =>
            cols.map((col, c) =>
              isRouted(col, row) ? (
                <g key={`${r}|${c}`}>
                  <line x1={cx(c)} y1={cy(r)} x2={width} y2={cy(r)} className={lineClass} strokeWidth={3} />
                  {(() => {
                    const text = badgeOf(col, row)
                    return text ? (
                      <>
                        <circle cx={cx(c)} cy={cy(r)} r={13} className={dotClass} />
                        <text x={cx(c)} y={cy(r)} textAnchor="middle" dominantBaseline="central" className="fill-accent-ink text-[15px] font-bold">
                          {text}
                        </text>
                      </>
                    ) : (
                      <circle cx={cx(c)} cy={cy(r)} r={8} className={dotClass} />
                    )
                  })()}
                </g>
              ) : null,
            ),
          )}
          {canTap &&
            rws.map((row, r) =>
              cols.map((col, c) => {
                const on = isRouted(col, row)
                if (!on && !fits(col, row)) return null
                return (
                  <rect
                    key={`${r}|${c}`}
                    x={cx(c) - CELL / 2}
                    y={cy(r) - CELL / 2}
                    width={CELL}
                    height={CELL}
                    fill="transparent"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${labelOf(col, rws, true)} → ${labelOf(row, cols, false)}`}
                    className="cursor-pointer"
                    onClick={() => tap(col, row)}
                  />
                )
              }),
            )}
        </svg>
      </div>
      <ul className="flex-shrink-0" style={{ paddingTop: HEADER }}>
        {rws.map((row, r) => {
          const any = cols.some((col) => isRouted(col, row))
          const group = groupToggle(row)
          const text = labelOf(row, cols, false)
          return (
            <li key={r} className="flex items-center gap-1 pr-1 text-base" style={{ height: CELL }}>
              <span className={`h-[3px] w-3 ${any ? (fixed ? 'bg-ink-faint' : 'bg-accent') : 'bg-transparent'}`} aria-hidden />
              {group ? (
                <button type="button" className={`min-h-form text-left ${any ? 'text-ink' : 'text-ink-muted'}`} aria-expanded={open.has(group.key)} aria-label={t('map.groupToggle', { name: group.label })} onClick={() => toggleGroup(group.key)}>
                  {`${open.has(group.key) ? '▾ ' : '▸ '}${text}`}
                </button>
              ) : (
                <span className={any ? 'text-ink' : 'text-ink-muted'}>{text}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

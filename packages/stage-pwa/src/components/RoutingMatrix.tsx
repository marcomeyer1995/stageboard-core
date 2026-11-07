import type { MatrixPoint } from 'shared-types'

export interface MatrixLine {
  key: string
  label: string
  point: MatrixPoint
}

const CELL = 48
const HEADER = 120

/**
 * A device's routing matrix (Marco, 2026-11-06): inputs are the columns, outputs the rows - their
 * names fixed on the right, "output means right". A routed cell draws the signal: down from its
 * input, at the cell turning right towards the output, like a patchbay. Fixed routing is drawn
 * greyed and cannot be tapped. On the phone the grid scrolls sideways, the outputs stay.
 */
export function RoutingMatrix({
  columns,
  rows,
  routed,
  fixed,
  editable,
  onToggle,
  label,
}: {
  columns: MatrixLine[]
  rows: MatrixLine[]
  routed: (from: MatrixPoint, to: MatrixPoint) => boolean
  fixed: boolean
  editable: boolean
  onToggle: (from: MatrixPoint, to: MatrixPoint, on: boolean) => void
  label: string
}) {
  const width = columns.length * CELL + CELL / 2
  const height = HEADER + rows.length * CELL
  const cx = (c: number) => c * CELL + CELL / 2
  const cy = (r: number) => HEADER + r * CELL + CELL / 2
  const lineClass = fixed ? 'stroke-ink-faint' : 'stroke-accent'
  const dotClass = fixed ? 'fill-ink-faint' : 'fill-accent'
  const canTap = editable && !fixed

  return (
    <div className="flex items-start" role="group" aria-label={label}>
      <div className="min-w-0 overflow-x-auto">
        <svg width={width} height={height} className="block">
          {columns.map((col, c) => (
            <text key={col.key} transform={`translate(${cx(c) + 5} ${HEADER - 8}) rotate(-60)`} className="fill-ink-soft text-[16px]">
              {col.label}
            </text>
          ))}
          {rows.map((row, r) =>
            columns.map((col, c) => <circle key={`${row.key}|${col.key}`} cx={cx(c)} cy={cy(r)} r={3} className="fill-ink-faint" />),
          )}
          {columns.map((col, c) => {
            const last = rows.reduce((max, row, r) => (routed(col.point, row.point) ? r : max), -1)
            return last < 0 ? (
              <line key={col.key} x1={cx(c)} y1={HEADER - 4} x2={cx(c)} y2={HEADER + 8} className="stroke-ink-faint" strokeWidth={3} />
            ) : (
              <line key={col.key} x1={cx(c)} y1={HEADER - 4} x2={cx(c)} y2={cy(last)} className={lineClass} strokeWidth={3} />
            )
          })}
          {rows.map((row, r) =>
            columns.map((col, c) =>
              routed(col.point, row.point) ? (
                <g key={`${row.key}|${col.key}`}>
                  <line x1={cx(c)} y1={cy(r)} x2={width} y2={cy(r)} className={lineClass} strokeWidth={3} />
                  <circle cx={cx(c)} cy={cy(r)} r={8} className={dotClass} />
                </g>
              ) : null,
            ),
          )}
          {canTap &&
            rows.map((row, r) =>
              columns.map((col, c) => {
                const on = routed(col.point, row.point)
                return (
                  <rect
                    key={`${row.key}|${col.key}`}
                    x={cx(c) - CELL / 2}
                    y={cy(r) - CELL / 2}
                    width={CELL}
                    height={CELL}
                    fill="transparent"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${col.label} → ${row.label}`}
                    className="cursor-pointer"
                    onClick={() => onToggle(col.point, row.point, !on)}
                  />
                )
              }),
            )}
        </svg>
      </div>
      <ul className="flex-shrink-0" style={{ paddingTop: HEADER }}>
        {rows.map((row) => {
          const any = columns.some((col) => routed(col.point, row.point))
          return (
            <li key={row.key} className="flex items-center gap-1 pr-1 text-base" style={{ height: CELL }}>
              <span className={`h-[3px] w-3 ${any ? (fixed ? 'bg-ink-faint' : 'bg-accent') : 'bg-transparent'}`} aria-hidden />
              <span className={any ? 'text-ink' : 'text-ink-muted'}>{row.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

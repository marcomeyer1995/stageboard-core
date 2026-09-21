import type { GuitarShape } from '../lib/guitarShapes'

const STRINGS = 6
const FRETS_SHOWN = 5
const LEFT = 22
const STRING_GAP = 15.2
const TOP = 34
const FRET_GAP = 20

/** A guitar chord box (#24): six strings, five frets, dots where to press, `x`/`o` above the
 * muted/open strings, and the starting fret when the shape sits above the nut. */
export function GuitarChordDiagram({ shape }: { shape: GuitarShape }) {
  const width = LEFT + STRING_GAP * (STRINGS - 1) + 14
  const height = TOP + FRET_GAP * FRETS_SHOWN + 8
  const stringX = (string: number) => LEFT + string * STRING_GAP
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Griffbild" className="h-full w-full max-w-[9rem]">
      {Array.from({ length: FRETS_SHOWN + 1 }, (_, line) => (
        <line
          key={`fret-${line}`}
          x1={stringX(0)}
          x2={stringX(STRINGS - 1)}
          y1={TOP + line * FRET_GAP}
          y2={TOP + line * FRET_GAP}
          className="stroke-ink-faint"
          strokeWidth={line === 0 && shape.baseFret === 1 ? 3.5 : 1}
        />
      ))}
      {Array.from({ length: STRINGS }, (_, string) => (
        <line key={`string-${string}`} x1={stringX(string)} x2={stringX(string)} y1={TOP} y2={TOP + FRET_GAP * FRETS_SHOWN} className="stroke-ink-faint" strokeWidth={1} />
      ))}
      {shape.baseFret > 1 && (
        <text x={2} y={TOP + FRET_GAP * 0.65} className="fill-ink" fontSize={11} fontWeight={700}>
          {shape.baseFret}fr
        </text>
      )}
      {shape.frets.map((fret, string) => {
        const x = stringX(string)
        if (fret === null) {
          return (
            <text key={`mark-${string}`} x={x} y={TOP - 9} textAnchor="middle" className="fill-ink-faint" fontSize={12}>
              ×
            </text>
          )
        }
        if (fret === 0) {
          return <circle key={`mark-${string}`} cx={x} cy={TOP - 12} r={3.6} className="fill-none stroke-ink-faint" strokeWidth={1.4} />
        }
        const row = fret - shape.baseFret
        return <circle key={`mark-${string}`} cx={x} cy={TOP + row * FRET_GAP + FRET_GAP / 2} r={5.6} className="fill-accent" />
      })}
    </svg>
  )
}

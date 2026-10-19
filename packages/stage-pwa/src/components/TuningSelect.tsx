import { useId } from 'react'
import type { Tuning } from 'shared-types'
import { tuningLabel } from '../lib/pitch'
import { INPUT } from './ui/styles'

const OFFSETS = [0, -1, -2, -3, -4, -5, -6, 1, 2]
const DROPS = [0, -1, -2, -3, -4]
const OPENS: Tuning[] = [
  { semitones: 0, open: 'dadgad' },
  { semitones: 0, open: 'open-g' },
  { semitones: 0, open: 'open-d' },
  { semitones: 0, open: 'open-e' },
]

function encode(tuning: Tuning): string {
  return `${tuning.semitones}|${tuning.drop ? 'drop' : (tuning.open ?? '')}`
}

function decode(value: string): Tuning {
  const [steps, kind] = value.split('|')
  const semitones = Number(steps)
  if (kind === 'drop') return { semitones, drop: true }
  if (kind) return { semitones, open: kind as NonNullable<Tuning['open']> }
  return { semitones }
}

/**
 * The guided tuning picker (Marco, 2026-10-18: no free text) - whole neck up/down, Drop, open
 * tunings. `undefined` reads as Standard; a value outside the usual list (e.g. read from an
 * import) is offered as well.
 */
export function TuningSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: Tuning | undefined
  onChange: (tuning: Tuning) => void
}) {
  const id = useId()
  const whole = OFFSETS.map((semitones): Tuning => ({ semitones }))
  const drops = DROPS.map((semitones): Tuning => ({ semitones, drop: true }))
  const known = new Set([...whole, ...drops, ...OPENS].map(encode))
  const current = encode(value ?? { semitones: 0 })
  return (
    <div className="flex min-w-0 flex-col gap-1 text-sm text-ink-muted">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={`min-h-form px-3 text-base ${INPUT}`}
        value={current}
        onChange={(e) => onChange(decode(e.target.value))}
      >
        {value && !known.has(current) && <option value={current}>{tuningLabel(value)}</option>}
        <optgroup label="Ganzer Hals">
          {whole.map((tuning) => (
            <option key={encode(tuning)} value={encode(tuning)}>
              {tuningLabel(tuning)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Drop (tiefste Saite einen Ton tiefer)">
          {drops.map((tuning) => (
            <option key={encode(tuning)} value={encode(tuning)}>
              {tuningLabel(tuning)}
            </option>
          ))}
        </optgroup>
        <optgroup label="Offen (Akkorde wie geschrieben)">
          {OPENS.map((tuning) => (
            <option key={encode(tuning)} value={encode(tuning)}>
              {tuningLabel(tuning)}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  )
}

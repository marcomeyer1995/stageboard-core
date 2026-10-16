import { useId } from 'react'
import { IconButton } from './IconButton'

/**
 * A number set with − / + and the value between (Marco, 2026-10-16): a slider in a scrolling page
 * changed whenever a finger brushed over it while scrolling. One step per tap, held at min / max.
 */
export function Stepper({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit: string; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const labelId = useId()
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)))
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={labelId} className="text-base text-ink-soft">
        {label}
      </span>
      <div className="flex items-center gap-2" role="group" aria-labelledby={labelId}>
        <IconButton icon="decrease" label="Kleiner" onClick={() => set(value - step)} disabled={value <= min} />
        <output className="min-w-[4.5rem] text-center text-lg font-semibold text-ink" aria-live="polite">
          {value} {unit}
        </output>
        <IconButton icon="increase" label="Größer" onClick={() => set(value + step)} disabled={value >= max} />
      </div>
    </div>
  )
}

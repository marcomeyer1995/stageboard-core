import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { CONTROL, DISABLED, FOCUS, HOVER, SIZE, type ControlSize } from './styles'

export interface ToggleChipProps {
  label: string
  selected: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  title?: string
  size?: ControlSize
}

/** Pick several (D7): a separate chip with a checkbox in front - empty box and outline when not
 * chosen, ticked box and fill when chosen. Tapping a chosen chip removes it. The box is always
 * there, so the chip never changes width (Marco, 2026-10-07: no shifting, but also no empty gap
 * in front of the text - the checkbox gives that room a meaning). */
export function ToggleChip({ label, selected, onToggle, disabled, title, size = 'form' }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={() => onToggle(!selected)}
      // Hover only where a mouse hovers - on touch it stuck after the tap.
      className={`inline-flex items-center gap-2 border font-semibold ${SIZE[size]} ${CONTROL} ${FOCUS} ${DISABLED} ${
        selected ? 'border-accent bg-accent text-accent-ink' : `border-ink-faint bg-transparent text-ink-soft ${HOVER}`
      }`}
    >
      <span
        aria-hidden="true"
        data-checkbox={selected ? 'checked' : 'empty'}
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[min(var(--sb-radius-sm),0.25rem)] border-2 ${
          selected ? 'border-accent-ink bg-accent-ink text-accent' : 'border-current'
        }`}
      >
        {selected && <Icon name="check" size="0.9rem" />}
      </span>
      {label}
    </button>
  )
}

/** A group of chips under one question, with the "several allowed" hint (docs/15 §4). */
export function ChipGroup({ label, hint = 'Mehrere möglich', children }: { label: string; hint?: string | null; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint && <p className="text-sm text-ink-faint">{hint}</p>}
    </div>
  )
}

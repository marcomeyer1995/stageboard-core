import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { CONTROL, DISABLED, FOCUS, SELECTED, SIZE, type ControlSize } from './styles'

export interface ToggleChipProps {
  label: string
  selected: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  title?: string
  size?: ControlSize
}

/** Pick several (D7): a separate chip, ✓ and filled when chosen, outlined when not. Tapping a
 * chosen chip removes it. */
export function ToggleChip({ label, selected, onToggle, disabled, title, size = 'form' }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={() => onToggle(!selected)}
      className={`inline-flex items-center gap-2 border ${SIZE[size]} ${CONTROL} ${FOCUS} ${DISABLED} ${
        selected ? `border-accent ${SELECTED}` : 'border-ink-faint bg-transparent text-ink-soft hover:bg-control-hover'
      }`}
    >
      {selected && <Icon name="check" size="1.1em" />}
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

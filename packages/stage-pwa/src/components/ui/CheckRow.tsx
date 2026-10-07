import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { MENU_ROW } from './ActionMenu'

/** The chips' checkbox (docs/15 D7) on a full-width row - pick several from a list that is too
 * long or too wordy for chips (songs for a new setlist, a prompt's multiple choice). */
export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-checkbox={checked ? 'checked' : 'empty'}
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[min(var(--sb-radius-sm),0.25rem)] border-2 ${
        checked ? 'border-accent bg-accent text-accent-ink' : 'border-current'
      }`}
    >
      {checked && <Icon name="check" size="0.9rem" />}
    </span>
  )
}

export function CheckRow({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle} className={`${MENU_ROW} gap-3 ${checked ? 'text-ink' : 'text-ink-soft'}`}>
      <CheckBox checked={checked} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

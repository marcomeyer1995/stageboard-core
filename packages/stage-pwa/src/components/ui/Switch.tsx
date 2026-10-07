import { useId } from 'react'
import { CONTROL, DISABLED, FOCUS } from './styles'

export interface SwitchProps {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  description?: string
  disabled?: boolean
  /** 'row': the whole row is the target (settings lists, 52+ px); 'inline': label + knob in a toolbar. */
  layout?: 'row' | 'inline'
}

/** One setting on or off (D5): a knob on a track, yellow and right = on. */
export function Switch({ label, checked, onChange, description, disabled, layout = 'row' }: SwitchProps) {
  const descriptionId = useId()
  const knob = (
    <span
      aria-hidden
      className={`relative inline-block h-8 w-14 flex-shrink-0 rounded-sb-pill transition-colors ${checked ? 'bg-accent' : 'bg-control-strong'}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-sb-pill transition-[left] ${checked ? 'left-7 bg-accent-ink' : 'left-1 bg-ink-soft'}`} />
    </span>
  )
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 text-left text-base text-ink-soft ${FOCUS} ${DISABLED} ${CONTROL} ${
        layout === 'row' ? 'min-h-form w-full justify-between bg-control px-4 py-2 hover:bg-control-hover' : 'min-h-form bg-control px-3 hover:bg-control-hover'
      }`}
    >
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {description && (
          <span id={descriptionId} className="text-sm text-ink-faint">
            {description}
          </span>
        )}
      </span>
      {knob}
    </button>
  )
}

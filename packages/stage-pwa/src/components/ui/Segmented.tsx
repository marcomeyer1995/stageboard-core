import { CONTROL, DISABLED, FOCUS, SELECTED, SIZE, type ControlSize, HOVER } from './styles'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the whole question ("Modus", "Sichtbar für"). */
  label: string
  size?: ControlSize
  /** Show `label` above the bar (settings forms); otherwise it only names the group for screen readers. */
  showLabel?: boolean
  /** Tapping the chosen option again (otherwise nothing happens) - e.g. to reverse a sort. */
  onSelectedTap?: () => void
  hint?: string
}

/**
 * Pick exactly one (D7): one joined bar, the chosen segment filled. Tapping the chosen segment
 * again changes nothing - the bar always has an answer.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'form', showLabel = false, hint, onSelectedTap }: SegmentedProps<T>) {
  const bar = (
    <div role="radiogroup" aria-label={label} className={`flex w-full gap-0 border border-line bg-control p-1 ${CONTROL}`}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => (selected ? onSelectedTap?.() : onChange(option.value))}
            className={`flex flex-1 items-center justify-center whitespace-nowrap ${SIZE[size]} ${options.length >= 5 ? '!px-1.5' : '!px-3'} ${CONTROL} ${FOCUS} ${DISABLED} ${
              selected ? SELECTED : `text-ink-soft ${HOVER}`
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
  if (!showLabel && !hint) return bar
  // In a settings form: the question above the bar, like a field's label (docs/15 §4).
  return (
    <div className="flex flex-col gap-1">
      {showLabel && <p className="text-sm font-semibold text-ink-soft">{label}</p>}
      {bar}
      {hint && <p className="text-sm text-ink-faint">{hint}</p>}
    </div>
  )
}

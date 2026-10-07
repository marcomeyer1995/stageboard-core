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
}

/**
 * Pick exactly one (D7): one joined bar, the chosen segment filled. Tapping the chosen segment
 * again changes nothing - the bar always has an answer.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'form' }: SegmentedProps<T>) {
  return (
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
            onClick={() => !selected && onChange(option.value)}
            className={`flex flex-1 items-center justify-center ${SIZE[size]} !px-3 ${CONTROL} ${FOCUS} ${DISABLED} ${
              selected ? SELECTED : `text-ink-soft ${HOVER}`
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

import { FOCUS } from './styles'

export interface TabsProps<T extends string> {
  tabs: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
}

/** Switch between pages (docs/15 §3): text with a yellow underline - clearly not a setting. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-1 border-b border-line">
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={`-mb-px min-h-form border-b-[3px] px-4 text-base ${FOCUS} ${
              selected ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-soft [@media(hover:hover)]:hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

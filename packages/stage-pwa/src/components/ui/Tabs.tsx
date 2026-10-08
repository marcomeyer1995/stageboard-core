import { FOCUS } from './styles'

export interface TabsProps<T extends string> {
  tabs: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  /** 'vertical': a side list (System on wide screens) - the bar sits on the left instead of below. */
  orientation?: 'horizontal' | 'vertical'
}

/** Switch between pages (docs/15 §3): text with a yellow underline - clearly not a setting. */
export function Tabs<T extends string>({ tabs, value, onChange, label, orientation = 'horizontal' }: TabsProps<T>) {
  const vertical = orientation === 'vertical'
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={vertical ? 'flex flex-col gap-1' : 'flex flex-wrap gap-x-1 border-b border-line'}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={`min-h-form px-4 text-base ${vertical ? 'border-l-[3px] text-left' : '-mb-px border-b-[3px]'} ${FOCUS} ${
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

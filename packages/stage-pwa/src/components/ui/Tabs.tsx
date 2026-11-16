import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../Icon'
import { FOCUS } from './styles'

export interface TabsProps<T extends string> {
  /** `icon`: below 600 px the tab shows only the icon (label stays its accessible name) - for
   * headers where the words don't fit on the phone (#603). */
  tabs: { value: T; label: string; icon?: IconName }[]
  value: T
  onChange: (value: T) => void
  label: string
  /** 'vertical': a side list (System on wide screens) - the bar sits on the left instead of below. */
  orientation?: 'horizontal' | 'vertical'
}

/** Phone width (< 600 px, like the timeline's PHONE_WIDTH): one row that scrolls sideways - never
 * shrunk by a column around it (a scrolling box may shrink to 0 there, the editor's tabs did). */
const PHONE_ROW = 'max-[599px]:flex-nowrap max-[599px]:overflow-x-auto max-[599px]:overflow-y-hidden'

/** Switch between pages (docs/15 §3): text with a yellow underline - clearly not a setting.
 * Horizontal tabs wrap (#373) - on the phone they took three rows, so there they are one row
 * that scrolls sideways, the chosen tab kept in view (Marco, 2026-10-16). */
export function Tabs<T extends string>({ tabs, value, onChange, label, orientation = 'horizontal' }: TabsProps<T>) {
  const vertical = orientation === 'vertical'
  const selectedRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  // More tabs off one edge (the phone's row scrolls sideways): an arrow there says so (Marco,
  // 2026-11-14, #860) - and a tap on it scrolls on.
  const [more, setMore] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const row = rowRef.current
    if (!row || vertical) return
    const left = row.scrollLeft > 2
    const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 2
    setMore((was) => (was.left === left && was.right === right ? was : { left, right }))
  }, [vertical])
  useEffect(() => {
    if (!vertical) selectedRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    measure()
  }, [value, vertical, measure])
  useEffect(() => {
    const row = rowRef.current
    if (!row || vertical || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [vertical, measure])
  const scrollBy = (direction: 1 | -1) => rowRef.current?.scrollBy?.({ left: direction * rowRef.current.clientWidth * 0.6, behavior: 'smooth' })
  const tablist = (
    <div
      ref={rowRef}
      onScroll={vertical ? undefined : measure}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      className={vertical ? 'flex flex-col gap-1' : `flex flex-none flex-wrap gap-x-1 border-b border-line ${PHONE_ROW}`}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={tab.icon ? tab.label : undefined}
            title={tab.icon ? tab.label : undefined}
            ref={selected ? selectedRef : undefined}
            onClick={() => onChange(tab.value)}
            className={`min-h-form flex-none whitespace-nowrap px-4 text-base ${tab.icon ? 'max-[599px]:px-3' : ''} ${vertical ? 'border-l-[3px] text-left' : '-mb-px border-b-[3px]'} ${FOCUS} ${
              selected ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-soft [@media(hover:hover)]:hover:text-ink'
            }`}
          >
            {tab.icon ? (
              <>
                <Icon name={tab.icon} size="1.4em" className="min-[600px]:hidden" />
                <span className="max-[599px]:hidden">{tab.label}</span>
              </>
            ) : (
              tab.label
            )}
          </button>
        )
      })}
    </div>
  )
  if (vertical) return tablist
  // The arrows lie over the row's ends on a fade of the page's background; they are only a hint
  // and a shortcut (the tabs themselves stay reachable by swiping and the keyboard).
  const arrow = (side: 'left' | 'right') => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={() => scrollBy(side === 'left' ? -1 : 1)}
      className={`absolute inset-y-0 ${side === 'left' ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l'} flex w-12 items-center ${side === 'left' ? 'justify-start' : 'justify-end'} from-stage via-stage/90 to-transparent text-ink-soft`}
    >
      <Icon name={side === 'left' ? 'previous' : 'next'} size="1.4em" />
    </button>
  )
  return (
    <div className="relative flex-none">
      {tablist}
      {more.left && arrow('left')}
      {more.right && arrow('right')}
    </div>
  )
}

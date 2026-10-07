import type { ReactNode } from 'react'
import { CONTAINER, CONTROL, FOCUS } from './styles'

/** A separate object on the page; shadow only when it floats (`raised`). */
export function Card({ children, raised = false, className = '' }: { children: ReactNode; raised?: boolean; className?: string }) {
  return <div className={`border border-line bg-surface p-4 ${CONTAINER} ${raised ? 'shadow-sb' : ''} ${className}`}>{children}</div>
}

/** Uppercase label over a group, optional hint below - as in the burger menu. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-widest text-ink-faint">{title}</h3>
      {children}
      {hint && <p className="text-sm text-ink-faint">{hint}</p>}
    </section>
  )
}

export interface ListRowProps {
  title: ReactNode
  subtitle?: ReactNode
  leading?: ReactNode
  /** Actions on the right (⋯, badges) - stay outside the row's own tap target. */
  trailing?: ReactNode
  onClick?: () => void
  /** The chosen entry of a pick-one list (menu dashboards): solid yellow. */
  selected?: boolean
}

/** One row of a list (songs, setlist entries, members, dashboards): 56 px, title + subtitle. */
export function ListRow({ title, subtitle, leading, trailing, onClick, selected = false }: ListRowProps) {
  const body = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {leading}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-base font-medium">{title}</span>
        {subtitle && <span className={`truncate text-sm ${selected ? 'text-accent-ink/80' : 'text-ink-faint'}`}>{subtitle}</span>}
      </span>
    </span>
  )
  return (
    <div className={`flex min-h-stage items-center gap-2 pr-2 ${CONTROL} ${selected ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft'}`}>
      {onClick ? (
        <button type="button" onClick={onClick} aria-current={selected ? 'true' : undefined} className={`flex min-h-stage min-w-0 flex-1 items-center px-4 text-left ${CONTROL} ${FOCUS} ${selected ? '' : 'hover:bg-control-hover'}`}>
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center px-4">{body}</div>
      )}
      {trailing && <span className="flex flex-shrink-0 items-center gap-2">{trailing}</span>}
    </div>
  )
}

import { Icon } from '../Icon'
import { DISABLED, FOCUS } from './styles'

/**
 * "Add a new entry" (docs/15, Marco 2026-10-07: every add looked different - this lean one is the
 * rule): a dashed outline with a yellow "+ label", at the end of the list it adds to, full width.
 * `inline` for the few that sit beside a heading instead (Bibliothek) - same look, as wide as its
 * text. Not for toolbar main actions ("+ Widget") or editor insert tools ("+ Kommentar").
 */
export function AddRow({ label, onClick, disabled, inline = false, title }: { label: string; onClick: () => void; disabled?: boolean; inline?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex min-h-form items-center justify-center gap-2 rounded-control border border-dashed border-line px-4 text-base font-medium text-accent [@media(hover:hover)]:hover:bg-control-hover ${
        inline ? 'flex-shrink-0' : 'w-full'
      } ${FOCUS} ${DISABLED}`}
    >
      <Icon name="add" size="1.15rem" />
      {label}
    </button>
  )
}

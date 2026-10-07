import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useBackHandler } from '../lib/backNavigation'
import { Icon } from './Icon'

/**
 * The "⋮ opens a popup of actions" pattern (see BandManagementView.tsx's member-row follow-up,
 * found live on a phone: a row of inline text-link actions has no bound on how many can pile
 * up, and on a narrow screen runs out of horizontal room instead of wrapping onto a readable
 * line). Deliberately generic - not band/member-specific - so any future list of rows (songs,
 * setlists, plugins, ...) reaches for these same three pieces instead of a bespoke inline-links
 * row that will eventually hit the same phone-width problem: `RowMenuButton` as the one always-
 * reachable trigger per row, `RowActionsMenu` as the popup shell (title, backdrop-to-close,
 * "Schließen"), `RowActionButton` for each action inside it. The row itself, if it represents
 * something selectable, should call its own onClick/onSelect directly (as here) rather than
 * needing a "Auswählen" entry in this popup at all.
 */
export function RowMenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-control text-lg leading-none text-ink-faint [@media(hover:hover)]:hover:bg-control-hover [@media(hover:hover)]:hover:text-ink-soft"
    >
      <Icon name="moreVertical" size="1.25rem" />
    </button>
  )
}

export function RowActionsMenu({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children?: ReactNode
}) {
  useBackHandler(onClose)
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      {/* Stops the overlay's own onClick (which closes the popup) from firing when the tap
          lands on the card itself, not the backdrop around it. */}
      <div className="w-full max-w-sm space-y-2 rounded-control border border-line bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-semibold">{title}</h3>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-control bg-control px-4 py-2 text-ink-soft [@media(hover:hover)]:hover:bg-control-hover"
        >
          Schließen
        </button>
      </div>
    </div>
  )
}

export function RowActionButton({
  danger,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`w-full rounded-control border border-line px-4 py-2 text-left [@media(hover:hover)]:hover:bg-control-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent ${
        danger ? 'text-red-400' : ''
      } ${className ?? ''}`}
    />
  )
}

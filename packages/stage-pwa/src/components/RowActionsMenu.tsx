import type { ButtonHTMLAttributes, ReactNode } from 'react'

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
      className="flex-shrink-0 rounded-sb px-2 py-1 text-lg leading-none text-ink-faint hover:bg-control-hover hover:text-ink-soft"
    >
      ⋮
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
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      {/* Stops the overlay's own onClick (which closes the popup) from firing when the tap
          lands on the card itself, not the backdrop around it. */}
      <div className="w-full max-w-sm space-y-2 rounded-sb border border-line bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-semibold">{title}</h3>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-sb bg-control px-4 py-2 text-ink-soft hover:bg-control-hover"
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
      className={`w-full rounded-sb border border-line px-4 py-2 text-left hover:bg-control-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent ${
        danger ? 'text-red-400' : ''
      } ${className ?? ''}`}
    />
  )
}

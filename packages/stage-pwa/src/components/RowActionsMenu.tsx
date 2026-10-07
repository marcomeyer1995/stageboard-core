import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Dialog, IconButton, MENU_ROW } from './ui'

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
  return <IconButton icon="moreVertical" variant="quiet" label={label} onClick={onClick} />
}

/** The popup shell - the shared dialog (docs/15 D6): "Abbrechen" at the bottom, since picking
 * an action already closes it. */
export function RowActionsMenu({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <Dialog title={title} size="s" closeLabel="Abbrechen" onClose={onClose}>
      <div className="flex flex-col gap-2">{children}</div>
    </Dialog>
  )
}

export function RowActionButton({ danger, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return <button type="button" {...props} className={`${MENU_ROW} ${danger ? 'text-red-400' : 'text-ink'} ${className ?? ''}`} />
}

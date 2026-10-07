import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../../lib/backNavigation'
import { Button } from './Button'
import { CONTAINER } from './styles'

const WIDTH = { s: 'max-w-sm', m: 'max-w-md', l: 'max-w-3xl' } as const

export interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Something to confirm (D6): the bottom row - secondary ("Abbrechen") left, main action right. */
  actions?: ReactNode
  /** Without `actions`: the single button that closes - "Fertig" (changes apply at once), or e.g.
   * "Abbrechen" for a menu where choosing an entry already closes it. */
  closeLabel?: string
  size?: keyof typeof WIDTH
}

/**
 * Every dialog (D6): the way out is always in the same place - the fixed bottom row, which never
 * scrolls away and sits under the thumb (Marco, 2026-10-07: top in one dialog and bottom in the
 * next was inconsistent; "Schließen" and "Abbrechen" twice was redundant). With something to
 * confirm: "Abbrechen" left, main action right. Without: one "Fertig" on the right. The title row
 * only names the dialog. Back gesture and a tap beside the dialog close it.
 */
export function Dialog({ title, onClose, children, actions, closeLabel = 'Fertig', size = 'm' }: DialogProps) {
  useBackHandler(onClose)
  return createPortal(
    <div className="fixed inset-0 z-dialog flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[min(90vh,90dvh)] w-full ${WIDTH[size]} flex-col overflow-hidden border border-line bg-surface shadow-sb ${CONTAINER}`}
      >
        <div className="flex flex-shrink-0 items-center border-b border-line px-4 py-3">
          <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">{children}</div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          {actions ?? (
            <Button variant="primary" onClick={onClose} className="ml-auto">
              {closeLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

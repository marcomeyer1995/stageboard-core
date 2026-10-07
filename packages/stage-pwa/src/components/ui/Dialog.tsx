import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../../lib/backNavigation'
import { Icon } from '../Icon'
import { CONTAINER, CONTROL, FOCUS } from './styles'

const WIDTH = { s: 'max-w-sm', m: 'max-w-md', l: 'max-w-3xl' } as const

export interface DialogProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Bottom action row (D6): secondary left, main action right. */
  actions?: ReactNode
  size?: keyof typeof WIDTH
}

/**
 * Every dialog (D6): title left and "× Schließen" right in the header, the content scrolls, the
 * actions sit at the bottom. Back gesture and a tap beside the dialog close it.
 */
export function Dialog({ title, onClose, children, actions, size = 'm' }: DialogProps) {
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
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="min-w-0 truncate text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={`flex min-h-form flex-shrink-0 items-center gap-2 bg-control-strong px-4 text-base font-medium text-ink hover:bg-control-strong-hover ${CONTROL} ${FOCUS}`}
          >
            <Icon name="close" size="1.25rem" />
            Schließen
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">{children}</div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

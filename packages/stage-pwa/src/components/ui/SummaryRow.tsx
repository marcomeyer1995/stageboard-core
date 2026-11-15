import { Icon } from '../Icon'
import { CONTROL, FOCUS, HOVER } from './styles'

/**
 * A list that grows (comment templates, the Nachbericht's categories - more with add-ons) as one
 * row with its summary: a tap opens it in a dialog (Marco, 2026-11-14, #862/#863), so the page
 * stays short.
 */
export function SummaryRow({ summary, label, onOpen }: { summary: string; label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${label}: ${summary}`}
      onClick={onOpen}
      className={`flex min-h-form w-full items-center gap-3 bg-control px-4 text-left text-base text-ink ${CONTROL} ${HOVER} ${FOCUS}`}
    >
      <span className="min-w-0 flex-1">{summary}</span>
      <Icon name="expand" />
    </button>
  )
}

import type { ReactNode } from 'react'
import type { CapabilityStatus } from '../lib/capabilities'

interface WidgetFrameProps {
  title: string
  status: CapabilityStatus
  isEditing: boolean
  hasConfig: boolean
  onConfigure: () => void
  onRemove: () => void
  children: ReactNode
}

/**
 * Wraps every placed widget. Its whole job is docs/07's Graceful Degradation: a widget
 * whose hardware is unreachable does NOT disappear - it stays exactly where the musician
 * expects it, greyed out and inert, so muscle memory survives and nothing shifts around
 * mid-show.
 */
export function WidgetFrame({
  title,
  status,
  isEditing,
  hasConfig,
  onConfigure,
  onRemove,
  children,
}: WidgetFrameProps) {
  const isDisabled = status === 'degraded'

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface">
      {isEditing && (
        <div className="flex items-center justify-between gap-2 border-b border-control bg-control px-2 py-1">
          {/* The handle is what react-grid-layout drags, so the widget body keeps its own
              buttons usable while editing. */}
          <span className="widget-drag-handle flex-1 cursor-move truncate text-xs text-ink-soft">
            {title}
          </span>
          {hasConfig && (
            <button
              type="button"
              onClick={onConfigure}
              title="Widget konfigurieren"
              className="rounded px-1 text-xs text-ink-muted hover:text-ink"
            >
              ⚙
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            title="Widget entfernen"
            className="rounded px-1 text-xs text-ink-muted hover:text-red-500"
          >
            ✕
          </button>
        </div>
      )}

      <div
        className={`min-h-0 flex-1 p-2 ${isDisabled ? 'pointer-events-none opacity-50' : ''}`}
        aria-disabled={isDisabled}
      >
        {children}
      </div>

      {isDisabled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            title="Hardware nicht erreichbar"
            className="rounded bg-stage/80 px-2 py-1 text-xs font-bold uppercase tracking-widest text-ink-muted"
          >
            ⃠ Offline
          </span>
        </div>
      )}
    </div>
  )
}

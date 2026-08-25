import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CapabilityStatus } from '../lib/capabilities'

interface WidgetFrameProps {
  title: string
  status: CapabilityStatus
  isEditing: boolean
  onRemove: () => void
  children: ReactNode
  /** Pre-rendered <ConfigPanel config={...} onChange={...} />, or undefined if this
   * widget type has none - shown inline in the same menu as Entfernen/Abbrechen. */
  configPanel?: ReactNode
}

/**
 * Wraps every placed widget. Its whole job is docs/07's Graceful Degradation: a widget
 * whose hardware is unreachable does NOT disappear - it stays exactly where the musician
 * expects it, greyed out and inert, so muscle memory survives and nothing shifts around
 * mid-show.
 *
 * In edit mode the whole body is the drag handle (see Dashboard.tsx's `.widget-drag-handle`
 * dragConfig) and the widget's own content goes inert - there is no real use case for
 * operating Start/Stop or a fader while rearranging a dashboard, and making it inert is
 * what frees the entire widget, not a thin strip of it, to be grabbed.
 *
 * The "⋯" button opens one menu with the widget's own config parameters (if any) and
 * "Entfernen" together - not a two-step "open a menu to open another menu". It closes via
 * its own "✕", or by tapping the backdrop beside it (capped well under full width on
 * purpose, so that backdrop is always reachable - see the panel's max-width below).
 * Double-click on the body opens it too, as a faster desktop-only shortcut: on a
 * touchscreen a double-click is not reliable here, since the same body is also the drag
 * handle, and the drag library's own touch handling can eat the second tap before the
 * browser ever synthesizes a dblclick from it. The button doesn't have that problem - an
 * ordinary tap always works - which is also why it, not another double-click, is what
 * removing a widget uses now.
 */
export function WidgetFrame({
  title,
  status,
  isEditing,
  onRemove,
  children,
  configPanel,
}: WidgetFrameProps) {
  const isDisabled = status === 'degraded'
  const [menuOpen, setMenuOpen] = useState(false)
  const inert = isDisabled || isEditing

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-sb border border-line bg-surface shadow-sb ${
        isEditing ? 'widget-drag-handle cursor-move' : ''
      }`}
      onDoubleClick={isEditing ? () => setMenuOpen(true) : undefined}
    >
      <div
        className={`min-h-0 flex-1 p-4 ${inert ? 'pointer-events-none' : ''} ${isDisabled ? 'opacity-50' : ''}`}
        aria-disabled={isDisabled}
      >
        {children}
      </div>

      {isEditing && (
        // Inset below the top edge on purpose: react-grid-layout's resize handles ring the
        // full perimeter (Dashboard.tsx enables all eight), including the whole top edge -
        // anything placed exactly on it, corner or center, sits under one of those dots.
        <div className="pointer-events-none absolute inset-x-2 top-5 flex items-center justify-between gap-2">
          <span className="truncate rounded-sb-sm bg-stage/70 px-2 py-0.5 text-xs text-ink-soft">
            {title}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            title="Widget-Menü"
            className="widget-menu pointer-events-auto flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sb-sm bg-stage/70 text-lg leading-none text-ink-soft hover:bg-control-hover"
          >
            ⋯
          </button>
        </div>
      )}

      {isDisabled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            title="Hardware nicht erreichbar"
            className="rounded-sb-sm bg-stage/80 px-2 py-1 text-xs font-bold uppercase tracking-widest text-ink-muted"
          >
            ⃠ Offline
          </span>
        </div>
      )}

      {menuOpen &&
        // Portalled to <body>, not rendered in place: react-grid-layout positions every
        // widget with a CSS transform, which creates a new containing block for anything
        // `position: fixed` underneath it - so a fixed-positioned menu here would still be
        // clipped to this one widget's small box instead of covering the screen (a two-row
        // widget doesn't have room to show "Entfernen" at all). A portal escapes that
        // ancestry entirely; `.widget-menu`/`cancel` stays as a harmless, self-documenting
        // safety net even though a portalled node isn't a DOM descendant of the drag
        // handle to begin with.
        createPortal(
          <div
            className="widget-menu fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3"
            onClick={() => setMenuOpen(false)}
          >
            <div
              // Capped at 85% of the viewport, not just a fixed pixel width: on a narrow
              // phone-width screen a 260px panel can eat the whole strip either side of it,
              // and closing-by-tapping-the-backdrop needs an actual backdrop left to tap.
              className="flex w-full max-w-[min(260px,85vw)] flex-col gap-3 rounded-sb border border-line bg-surface p-3 shadow-sb"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold uppercase tracking-widest text-ink-faint">
                  {title}
                </p>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  title="Schließen"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
                >
                  ✕
                </button>
              </div>

              {configPanel}

              {/* Deliberately last, with a divider and extra space above it, and in red:
                  the safety net against removing a widget by mistake is distance and
                  visual isolation from every other control in this menu, not a second
                  confirmation step. */}
              <div className="mt-2 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onRemove()
                  }}
                  className="h-11 w-full rounded-sb bg-control text-base text-red-400 hover:bg-control-hover hover:text-red-300"
                >
                  Entfernen
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

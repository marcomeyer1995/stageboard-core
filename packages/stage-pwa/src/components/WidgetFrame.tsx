import { useState, type ReactNode } from 'react'
import type { CapabilityStatus } from '../lib/capabilities'
import { Button, Dialog, Switch } from './ui'
import { Icon } from './Icon'

interface WidgetFrameProps {
  title: string
  status: CapabilityStatus
  isEditing: boolean
  onRemove: () => void
  children: ReactNode
  /** Pre-rendered <ConfigPanel config={...} onChange={...} />, or undefined if this
   * widget type has none - shown inline in the same menu as Entfernen/Abbrechen. */
  configPanel?: ReactNode
  /** Hides the border/background/padding chrome (Marco, 2026-09-14: a SeparatorWidget
   * shouldn't look like a boxed card). Defaults to false so every existing call site
   * (WidgetFrame.test.tsx included) keeps today's look with no change. */
  frameless?: boolean
  /** Only rendered in the menu when provided - Dashboard.tsx wires it per instance;
   * WidgetFrame.test.tsx's bare renders simply don't offer the toggle. */
  onToggleFrameless?: () => void
  /** Edit mode only: the widget is smaller than its minimum size - red outline and a
   * "zu klein" tag, so it is fixed while arranging, not discovered on stage. */
  tooSmall?: boolean
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
  frameless = false,
  onToggleFrameless,
  tooSmall = false,
}: WidgetFrameProps) {
  const isDisabled = status === 'degraded'
  const [menuOpen, setMenuOpen] = useState(false)
  const inert = isDisabled || isEditing
  // Hidden chrome is a live/locked-view thing only - while editing, every widget keeps its
  // border so its drag/resize bounds stay visible, same reasoning `inert` already applies.
  const hideChrome = frameless && !isEditing

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-container ${
        hideChrome ? '' : 'border border-line bg-surface shadow-sb'
      } ${isEditing ? 'widget-drag-handle cursor-move' : ''} ${isEditing && tooSmall ? 'outline outline-2 -outline-offset-2 outline-danger' : ''}`}
      onDoubleClick={isEditing ? () => setMenuOpen(true) : undefined}
    >
      <div
        className={`min-h-0 flex-1 ${hideChrome ? '' : 'p-4'} ${inert ? 'pointer-events-none' : ''} ${isDisabled ? 'opacity-50' : ''}`}
        aria-disabled={isDisabled}
      >
        {children}
      </div>

      {isEditing && (
        // Inset below the top edge on purpose: react-grid-layout's resize handles ring the
        // full perimeter (Dashboard.tsx enables all eight), including the whole top edge -
        // anything placed exactly on it, corner or center, sits under one of those dots.
        <div className="pointer-events-none absolute inset-x-2 top-5 flex items-center justify-between gap-2">
          <span className="truncate rounded-control bg-stage/70 px-2 py-0.5 text-xs text-ink-soft">
            {title}
            {tooSmall && <span className="font-bold text-danger"> · zu klein</span>}
          </span>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            title="Widget-Menü"
            className="widget-menu pointer-events-auto flex h-touch w-touch flex-shrink-0 items-center justify-center rounded-control bg-stage/70 text-lg leading-none text-ink-soft [@media(hover:hover)]:hover:bg-control-hover"
          >
            <Icon name="more" size="1.5rem" />
          </button>
        </div>
      )}

      {isDisabled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            title="Hardware nicht erreichbar"
            className="rounded-control bg-stage/80 px-2 py-1 text-xs font-bold uppercase tracking-widest text-ink-muted"
          >
            ⃠ Offline
          </span>
        </div>
      )}

      {menuOpen && (
        // The shared dialog (docs/15 D6), portalled to <body>: react-grid-layout positions every
        // widget with a CSS transform, which would clip a fixed-positioned menu to this one
        // widget's small box.
        <Dialog title={title} size="s" onClose={() => setMenuOpen(false)}>
          {configPanel}

          {onToggleFrameless && <Switch label="Rahmen anzeigen" checked={!frameless} onChange={onToggleFrameless} />}

          {/* Deliberately last, with a divider and extra space above it, and in red: the safety
              net against removing a widget by mistake is distance and visual isolation from
              every other control in this menu, not a second confirmation step. */}
          <div className="mt-2 border-t border-line pt-4">
            <Button
              variant="danger"
              fullWidth
              onClick={() => {
                setMenuOpen(false)
                onRemove()
              }}
            >
              Entfernen
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

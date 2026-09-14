import { useState } from 'react'
import { createPortal } from 'react-dom'

interface OverflowMenuAction {
  label: string
  onClick: () => void
  /** Styled in red with extra spacing above, isolated from the rest of the menu - the safety
   * net against a destructive action being triggered by mistake is distance and visual
   * isolation, not a second confirmation step inside this component (callers still run their
   * own `confirm()` before actually deleting anything, same as everywhere else in the app). */
  danger?: boolean
}

interface OverflowMenuProps {
  /** Shown as the menu's own heading - the name of the thing this menu acts on. */
  title: string
  actions: OverflowMenuAction[]
}

/**
 * Small "⋯" trigger opening one portalled menu - the same shape `WidgetFrame.tsx` already uses
 * for its own per-widget menu, extracted here so a song row (LibraryView) and a setlist header
 * (SetlistDetail) share one real implementation instead of two hand-copies that can drift apart
 * (Marco, explicit request to harmonize how a song vs. a setlist gets deleted). `WidgetFrame`
 * itself stays on its own inline version - not worth the risk of refactoring a third, working,
 * unrelated system into this just to remove one duplicate.
 */
export function OverflowMenu({ title, actions }: OverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const normal = actions.filter((a) => !a.danger)
  const danger = actions.filter((a) => a.danger)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Menü öffnen"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sb-sm bg-control-strong text-lg leading-none text-ink-soft hover:bg-control-strong-hover"
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex w-full max-w-[min(260px,85vw)] flex-col gap-3 rounded-sb border border-line bg-surface p-3 shadow-sb"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold uppercase tracking-widest text-ink-faint">{title}</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  title="Schließen"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-2">
                {normal.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      action.onClick()
                    }}
                    className="h-11 w-full rounded-sb bg-control text-base text-ink hover:bg-control-hover"
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              {danger.length > 0 && (
                <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
                  {danger.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        action.onClick()
                      }}
                      className="h-11 w-full rounded-sb bg-control text-base text-red-400 hover:bg-control-hover hover:text-red-300"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

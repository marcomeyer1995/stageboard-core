import { useState } from 'react'
import { Icon, type IconName } from './Icon'
import { ActionMenuDialog } from './ui'

export interface OverflowMenuAction {
  label: string
  onClick: () => void
  /** Styled in red with extra spacing above, isolated from the rest of the menu - the safety
   * net against a destructive action being triggered by mistake is distance and visual
   * isolation, not a second confirmation step inside this component (callers still run their
   * own `confirm()` before actually deleting anything, same as everywhere else in the app). */
  danger?: boolean
  /** Kept visible-but-disabled rather than omitted when an action doesn't currently apply
   * (e.g. "Zur aktiven Setlist hinzufügen" with no active setlist) - same "tell the user why,
   * don't just make it disappear" instinct the row's own "+" button already uses. */
  disabled?: boolean
}

interface OverflowMenuProps {
  /** Shown as the menu's own heading - the name of the thing this menu acts on. */
  title: string
  actions: OverflowMenuAction[]
  /** 'boxed' (default) is the standalone filled pill used in SetlistDetail's header/row.
   * 'flat' drops the fill so the trigger reads as an accent within a row that already has its
   * own background, the same way the ⠿ grip handle sits unboxed on the row's own bg-control -
   * LibraryView's song row (Marco, explicit request: "no separate visible box around the dots",
   * pointing at the grip handle as the reference). */
  variant?: 'boxed' | 'flat'
  /** Optionally controlled open state - omit both to let the component manage its own (the
   * common case, driven only by clicking the "⋯" trigger). Passed by LibraryView's song row so
   * a right-click anywhere on the row (the pointer lane's context-menu alternative to the
   * trigger, #178) can open this exact same menu instead of a second, hand-rolled one. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The trigger's symbol - the Live-Queue uses "⋮" so its row menu can't be mistaken for the
   * widget's own "⋯" menu beside it in edit mode (GUI audit 2026-09-26). */
  glyph?: IconName
  /** No visible trigger - the menu opens only through `open` (the Live-Queue's long press on a
   * row outside sort mode). */
  hideTrigger?: boolean
  /** 'touch' = the 56px Gig-tier target (the Live-Queue's row trigger in sort mode); the default
   * 40px suits the off-stage lists. */
  triggerSize?: 'default' | 'touch'
}

/**
 * Small "⋯" trigger opening one portalled menu - the same shape `WidgetFrame.tsx` already uses
 * for its own per-widget menu, extracted here so a song row (LibraryView) and a setlist header
 * (SetlistDetail) share one real implementation instead of two hand-copies that can drift apart
 * (Marco, explicit request to harmonize how a song vs. a setlist gets deleted). `WidgetFrame`
 * itself stays on its own inline version - not worth the risk of refactoring a third, working,
 * unrelated system into this just to remove one duplicate.
 */
export function OverflowMenu({
  title,
  actions,
  variant = 'boxed',
  open: controlledOpen,
  onOpenChange,
  glyph = 'more',
  hideTrigger = false,
  triggerSize = 'default',
}: OverflowMenuProps) {
  const size = triggerSize === 'touch' ? 'h-touch w-touch' : 'h-form w-form'
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Menü öffnen"
          className={
            variant === 'flat'
              ? `flex ${size} flex-shrink-0 items-center justify-center rounded-control text-lg leading-none text-ink-faint [@media(hover:hover)]:hover:bg-control-hover [@media(hover:hover)]:hover:text-ink`
              : `flex ${size} flex-shrink-0 items-center justify-center rounded-control bg-control-strong text-lg leading-none text-ink-soft [@media(hover:hover)]:hover:bg-control-strong-hover`
          }
        >
          <Icon name={glyph} size="1.4rem" />
        </button>
      )}
      {open && <ActionMenuDialog title={title} actions={actions} onClose={() => setOpen(false)} />}
    </>
  )
}

import { useState } from 'react'
import { useControlSize } from './PrepTier'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'
import { CONTROL, DISABLED, FOCUS, SELECTED, type ControlSize } from './styles'

export interface MenuAction {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

const ROW = `flex min-h-form w-full items-center px-4 text-left text-base ${CONTROL} ${FOCUS} ${DISABLED}`

/** One action row in a ⋯ menu - also for menus that build their rows themselves. */
export const MENU_ROW = `${ROW} bg-control [@media(hover:hover)]:hover:bg-control-hover`

/** A pick-one row (docs/15 D7), the chosen one yellow. MENU_ROW plus SELECTED stayed grey with
 * dark text - bg-control comes later in the stylesheet than bg-accent (2026-10-16). */
export function choiceRow(chosen: boolean, idle = 'text-ink'): string {
  return chosen ? `${ROW} ${SELECTED}` : `${MENU_ROW} ${idle}`
}

/** The open menu: the actions as full-width rows, dangerous ones in red and set apart at the
 * end; "Abbrechen" at the bottom (choosing an entry already closes it). */
export function ActionMenuDialog({ title, actions, onClose }: { title: string; actions: MenuAction[]; onClose: () => void }) {
  const normal = actions.filter((a) => !a.danger)
  const danger = actions.filter((a) => a.danger)
  const row = (action: MenuAction) => (
    <button
      key={action.label}
      type="button"
      disabled={action.disabled}
      onClick={() => {
        onClose()
        action.onClick()
      }}
      className={`${MENU_ROW} ${action.danger ? 'text-danger' : 'text-ink'}`}
    >
      {action.label}
    </button>
  )
  return (
    <Dialog title={title} size="s" closeLabel="Abbrechen" onClose={onClose}>
      {normal.length > 0 && <div className="flex flex-col gap-2">{normal.map(row)}</div>}
      {danger.length > 0 && <div className="flex flex-col gap-2 border-t border-line pt-3">{danger.map(row)}</div>}
    </Dialog>
  )
}

/** docs/15 D9: ⋯ for one entry among similar ones (widget, song, plugin, member row), ⋮ for the
 * whole page - always top right in its header (edit bar, opened setlist). The only place the two
 * symbols are chosen; the guard test keeps it that way. */
export function menuIcon(scope: 'entry' | 'page'): 'more' | 'moreVertical' {
  return scope === 'page' ? 'moreVertical' : 'more'
}

/**
 * Every ⋯ / ⋮ menu: a wide trigger, the actions as full-width rows in the dialog look; dangerous
 * ones in red, set apart at the end.
 */
export function ActionMenu({ title, actions, size: sizeProp, scope = 'entry' }: { title: string; actions: MenuAction[]; size?: ControlSize; scope?: 'entry' | 'page' }) {
  const size = useControlSize(sizeProp)
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton icon={menuIcon(scope)} label={`Menü: ${title}`} size={size} onClick={() => setOpen(true)} className="!w-16" />
      {open && <ActionMenuDialog title={title} actions={actions} onClose={() => setOpen(false)} />}
    </>
  )
}

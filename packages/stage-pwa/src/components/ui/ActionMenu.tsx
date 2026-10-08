import { useState } from 'react'
import { Dialog } from './Dialog'
import { IconButton } from './IconButton'
import { CONTROL, DISABLED, FOCUS, type ControlSize } from './styles'

export interface MenuAction {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** One action row in a ⋯ menu - also for menus that build their rows themselves. */
export const MENU_ROW = `flex min-h-form w-full items-center bg-control px-4 text-left text-base [@media(hover:hover)]:hover:bg-control-hover ${CONTROL} ${FOCUS} ${DISABLED}`

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

/**
 * Every ⋯ menu (widget, song, setlist row): a wide trigger, the actions as full-width rows in
 * the dialog look; dangerous ones in red, set apart at the end.
 */
export function ActionMenu({ title, actions, size = 'form' }: { title: string; actions: MenuAction[]; size?: ControlSize }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton icon="more" label={`Menü: ${title}`} size={size} onClick={() => setOpen(true)} className="!w-16" />
      {open && <ActionMenuDialog title={title} actions={actions} onClose={() => setOpen(false)} />}
    </>
  )
}

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

/**
 * Every ⋯ menu (widget, song, setlist row): a wide trigger, the actions as full-width rows in
 * the dialog look; dangerous ones in red, set apart at the end. Replaces OverflowMenu,
 * RowActionsMenu and the widget menu.
 */
export function ActionMenu({ title, actions, size = 'form' }: { title: string; actions: MenuAction[]; size?: ControlSize }) {
  const [open, setOpen] = useState(false)
  const normal = actions.filter((a) => !a.danger)
  const danger = actions.filter((a) => a.danger)
  const row = (action: MenuAction) => (
    <button
      key={action.label}
      type="button"
      disabled={action.disabled}
      onClick={() => {
        setOpen(false)
        action.onClick()
      }}
      className={`flex min-h-form w-full items-center bg-control px-4 text-left text-base hover:bg-control-hover ${CONTROL} ${FOCUS} ${DISABLED} ${action.danger ? 'text-red-400' : 'text-ink'}`}
    >
      {action.label}
    </button>
  )
  return (
    <>
      <IconButton icon="more" label={`Menü: ${title}`} size={size} onClick={() => setOpen(true)} className="!w-16" />
      {open && (
        <Dialog title={title} size="s" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-2">{normal.map(row)}</div>
          {danger.length > 0 && <div className="flex flex-col gap-2 border-t border-line pt-3">{danger.map(row)}</div>}
        </Dialog>
      )}
    </>
  )
}

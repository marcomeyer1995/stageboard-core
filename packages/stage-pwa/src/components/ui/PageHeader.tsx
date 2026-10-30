import { useState, type ReactNode } from 'react'
import { Button, type ButtonVariant } from './Button'
import { IconButton } from './IconButton'
import { ActionMenuDialog, menuIcon, type MenuAction } from './ActionMenu'
import type { IconName } from '../Icon'
import { useMediaQuery } from '../../lib/useMediaQuery'
import i18n from '../../i18n'

export interface PageAction {
  icon: IconName
  label: string
  onClick: () => void
  variant?: Extract<ButtonVariant, 'primary' | 'secondary' | 'danger'>
  disabled?: boolean
}

interface PageHeaderProps {
  /** ← top left (D8: where to go) - absent where there is nowhere to go back to. */
  back?: { label: string; onClick: () => void }
  /** Between ← and the actions, e.g. the song editor's views. */
  middle?: ReactNode
  /** Before the actions, e.g. "Gespeichert." */
  status?: ReactNode
  /** What this page can do (D8), the main one first: an icon on the phone, icon + word from 600 px
   * (900 px when there is a `middle`). */
  actions?: PageAction[]
  /** ⋮ for the whole page (D9), always last - also without rarer actions: the main actions open
   * it with their icon and name (muscle memory: ⋮ is on every page, and explains the icons). */
  menu?: { title: string; actions: MenuAction[] }
  /** The menu's title when there is no `menu` (the page's name). */
  menuTitle?: string
  /** Its own row, never cut off - a setlist named "Rocknacht Halle 2026 - SOAT+Abadschen" stays readable. */
  title?: ReactNode
  /** Beside the title, e.g. the "Aktiv" badge. */
  titleExtra?: ReactNode
  /** One grey line under the title: date, counts, artist. */
  subtitle?: ReactNode
}

/**
 * The header of every page (docs/15 D12, Marco 2026-10-30): one row of equally sized square
 * controls - ← left, the actions and ⋮ right - then the title in full and one grey line. The same
 * place and size on every page, so the hand finds them without looking.
 */
export function PageHeader({ back, middle, status, actions = [], menu, menuTitle, title, titleExtra, subtitle }: PageHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  // One element per action, picked by width (the phone gets the icon, 600 px and up icon + word).
  // With views in the middle (song editor) words only from 900 px: at 601 px "Speichern" pushed
  // "Details" onto a second row.
  const wide = useMediaQuery(middle ? '(min-width: 900px)' : '(min-width: 600px)')
  // ⋮ on every page: the main actions first, with symbol and name, then the rarer ones (2026-10-30).
  const menuActions: MenuAction[] = [
    ...actions.map((action) => ({ label: action.label, icon: action.icon, disabled: action.disabled, danger: action.variant === 'danger', onClick: action.onClick })),
    ...(menu?.actions ?? []),
  ]
  const shownMenuTitle = menu?.title ?? menuTitle ?? (typeof title === 'string' ? title : '')
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {back && <IconButton icon="back" label={back.label} onClick={back.onClick} />}
        <div className="flex min-w-0 flex-1 items-center">{middle}</div>
        {status}
        {actions.map((action) =>
          wide ? (
            <Button
              key={action.label}
              icon={action.icon}
              variant={action.variant ?? 'secondary'}
              disabled={action.disabled}
              onClick={action.onClick}
              className="flex-shrink-0"
            >
              {action.label}
            </Button>
          ) : (
            <IconButton
              key={action.label}
              icon={action.icon}
              label={action.label}
              variant={action.variant === 'primary' ? 'primary' : 'secondary'}
              disabled={action.disabled}
              onClick={action.onClick}
              className={action.variant === 'danger' ? '!text-danger' : ''}
            />
          ),
        )}
        {menuActions.length > 0 && (
          <>
            <IconButton icon={menuIcon('page')} label={i18n.t('common:ui.menu', { title: shownMenuTitle })} onClick={() => setMenuOpen(true)} />
            {menuOpen && <ActionMenuDialog title={shownMenuTitle} actions={menuActions} onClose={() => setMenuOpen(false)} />}
          </>
        )}
      </div>
      {title && (
        <h2 className="flex flex-wrap items-center gap-x-2 break-words text-2xl font-bold text-ink">
          <span className="min-w-0 break-words">{title}</span>
          {titleExtra}
        </h2>
      )}
      {subtitle && <div className="text-ink-faint">{subtitle}</div>}
    </div>
  )
}

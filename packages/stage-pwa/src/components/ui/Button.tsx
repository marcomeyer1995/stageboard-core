import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'
import { CONTROL, DISABLED, FOCUS, SIZE, type ControlSize } from './styles'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'

// Hover only where a mouse hovers - on touch it stuck after the tap (Play stayed lighter).
const VARIANT: Record<ButtonVariant, string> = {
  // The one main action of a place.
  primary: 'bg-accent text-accent-ink font-semibold [@media(hover:hover)]:hover:bg-accent-hover',
  // D3: the lighter grey, so a button never looks like an unselected segment.
  secondary: 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover',
  // Red only for faults and danger.
  danger: 'bg-control-strong text-danger [@media(hover:hover)]:hover:bg-control-strong-hover',
  // Inline, without a fill - still a full-height touch target.
  quiet: 'bg-transparent text-ink-soft [@media(hover:hover)]:hover:bg-control-hover',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** D2: show 72 (Play, Weiter), stage 56 (dashboards, menu), form 48 (settings, dialogs). */
  size?: ControlSize
  icon?: IconName
  fullWidth?: boolean
  children: ReactNode
}

/** Something that *does* something (docs/15 §4) - never a state; that is a Switch or a chip. */
export function Button({ variant = 'secondary', size = 'form', icon, fullWidth, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 ${SIZE[size]} ${CONTROL} ${VARIANT[variant]} ${FOCUS} ${DISABLED} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size="1.2em" />}
      {children}
    </button>
  )
}

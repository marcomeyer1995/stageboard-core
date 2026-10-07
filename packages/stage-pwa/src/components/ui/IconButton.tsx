import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from '../Icon'
import { CONTROL, DISABLED, FOCUS, SQUARE, type ControlSize } from './styles'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Required - the button has no visible text. */
  label: string
  size?: ControlSize
  variant?: 'secondary' | 'quiet' | 'primary'
}

const VARIANT = {
  secondary: 'bg-control-strong text-ink hover:bg-control-strong-hover',
  quiet: 'bg-transparent text-ink-soft hover:bg-control-hover',
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
} as const

/** ⋯, ×, ↑↓, steppers - never smaller than the form height (48 px). */
export function IconButton({ icon, label, size = 'form', variant = 'secondary', className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={`inline-flex flex-shrink-0 items-center justify-center ${SQUARE[size]} ${CONTROL} ${VARIANT[variant]} ${FOCUS} ${DISABLED} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size === 'form' ? '1.4rem' : '1.7rem'} />
    </button>
  )
}

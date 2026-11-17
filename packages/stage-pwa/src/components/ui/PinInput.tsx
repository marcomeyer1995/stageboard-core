import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from './IconButton'
import { INPUT_FREE } from './styles'

export interface PinInputProps {
  value: string
  /** Digits only, at most `length` of them. */
  onChange: (value: string) => void
  placeholder?: string
  /** For a field without a visible label (e.g. "PIN of Marco"). */
  ariaLabel?: string
  autoFocus?: boolean
  length?: number
  /** Classes for the row (the field and its eye button), e.g. `flex-1` beside a submit button. */
  className?: string
}

/**
 * A PIN field: masked by default - the screen on stage is visible to others, and screenshots or
 * screen sharing catch it - with the numeric keypad, and an eye button to show it while typing
 * (founding a band: a typo there locks the admin out). #898.
 */
export function PinInput({ value, onChange, placeholder, ariaLabel, autoFocus, length = 4, className = '' }: PinInputProps) {
  const { t } = useTranslation('common')
  const [shown, setShown] = useState(false)
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <input
        type={shown ? 'text' : 'password'}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={`h-form min-w-0 flex-1 px-3 text-center text-lg tracking-widest ${INPUT_FREE}`}
      />
      <IconButton
        icon={shown ? 'eyeOff' : 'eye'}
        label={shown ? t('ui.hidePin') : t('ui.showPin')}
        variant="quiet"
        size="form"
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      />
    </div>
  )
}

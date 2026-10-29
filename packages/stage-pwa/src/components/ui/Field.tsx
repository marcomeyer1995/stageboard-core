import i18n from '../../i18n'
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { useControlSize } from './PrepTier'
import { FOCUS, INPUT, SIZE, type ControlSize } from './styles'
import { InfoHint } from './InfoHint'


/** `hint` stays visible below (a status or a consequence); `info` is an explanation behind ⓘ beside the label (D12). */
function Wrap({ id, label, hint, info, error, children }: { id: string; label?: string; hint?: string; info?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <div className="flex min-w-0 items-center gap-1">
          <label htmlFor={id} className="min-w-0 text-sm font-semibold text-ink-soft">
            {label}
          </label>
          {info && <InfoHint text={info} label={i18n.t('common:ui.explain', { label: label })} />}
        </div>
      )}
      {children}
      {error ? <p className="text-sm text-danger">{error}</p> : hint ? <p className="text-sm text-ink-faint">{hint}</p> : null}
    </div>
  )
}

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: string
  /** An explanation behind ⓘ beside the label (docs/15 D12). */
  info?: string
  error?: string
  size?: ControlSize
}

/** Text input: label above, hint or error below, one height (D2). */
export function Field({ label, hint, info, error, size: sizeProp, id, className = '', ...rest }: FieldProps) {
  const size = useControlSize(sizeProp)
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Wrap id={fieldId} label={label} hint={hint} info={info} error={error}>
      <input id={fieldId} aria-invalid={error ? true : undefined} className={`${INPUT} ${SIZE[size]} ${error ? '!border-danger' : ''} ${className}`} {...rest} />
    </Wrap>
  )
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  /** An explanation behind ⓘ beside the label (docs/15 D12). */
  info?: string
  error?: string
}

export function TextArea({ label, hint, info, error, id, className = '', rows = 4, ...rest }: TextAreaProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Wrap id={fieldId} label={label} hint={hint} info={info} error={error}>
      <textarea id={fieldId} rows={rows} aria-invalid={error ? true : undefined} className={`${INPUT} px-4 py-3 text-base ${className}`} {...rest} />
    </Wrap>
  )
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  hint?: string
  /** An explanation behind ⓘ beside the label (docs/15 D12). */
  info?: string
  size?: ControlSize
  options: { value: string; label: string; disabled?: boolean }[]
}

/** Dropdown with the same height, corner and label as a Field. */
export function Select({ label, hint, info, size: sizeProp, options, id, className = '', onChange, ...rest }: SelectProps) {
  const size = useControlSize(sizeProp)
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Wrap id={fieldId} label={label} hint={hint} info={info}>
      <select
        id={fieldId}
        className={`${INPUT} ${SIZE[size]} ${className}`}
        onChange={(e) => {
          onChange?.(e)
          // After a pick by touch the select kept focus and Chromium showed its keyboard ring,
          // an orange frame that looked like a marking (2026-10-20). A keyboard user keeps focus.
          if (matchMedia('(pointer: coarse)').matches) e.currentTarget.blur()
        }}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Wrap>
  )
}

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: string
  /** Shown on the right of the label, e.g. "8 s". */
  valueLabel?: string
  value: number
  onChange: (value: number) => void
}

export function Slider({ label, valueLabel, value, onChange, id, ...rest }: SliderProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="flex items-center justify-between text-sm font-semibold text-ink-soft">
        {label}
        {valueLabel && <span className="font-normal text-ink-faint">{valueLabel}</span>}
      </label>
      <input id={fieldId} type="range" value={value} onChange={(e) => onChange(Number(e.target.value))} className={`h-form w-full accent-accent ${FOCUS}`} {...rest} />
    </div>
  )
}

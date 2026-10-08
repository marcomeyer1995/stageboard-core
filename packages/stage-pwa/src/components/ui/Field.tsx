import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { FOCUS, INPUT, SIZE, type ControlSize } from './styles'


function Wrap({ id, label, hint, error, children }: { id: string; label?: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-semibold text-ink-soft">
          {label}
        </label>
      )}
      {children}
      {error ? <p className="text-sm text-red-400">{error}</p> : hint ? <p className="text-sm text-ink-faint">{hint}</p> : null}
    </div>
  )
}

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: string
  error?: string
  size?: ControlSize
}

/** Text input: label above, hint or error below, one height (D2). */
export function Field({ label, hint, error, size = 'form', id, className = '', ...rest }: FieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Wrap id={fieldId} label={label} hint={hint} error={error}>
      <input id={fieldId} aria-invalid={error ? true : undefined} className={`${INPUT} ${SIZE[size]} ${error ? '!border-red-500' : ''} ${className}`} {...rest} />
    </Wrap>
  )
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export function TextArea({ label, hint, error, id, className = '', rows = 4, ...rest }: TextAreaProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Wrap id={fieldId} label={label} hint={hint} error={error}>
      <textarea id={fieldId} rows={rows} aria-invalid={error ? true : undefined} className={`${INPUT} px-4 py-3 text-base ${className}`} {...rest} />
    </Wrap>
  )
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  hint?: string
  size?: ControlSize
  options: { value: string; label: string; disabled?: boolean }[]
}

/** Dropdown with the same height, corner and label as a Field. */
export function Select({ label, hint, size = 'form', options, id, className = '', ...rest }: SelectProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <Wrap id={fieldId} label={label} hint={hint}>
      <select id={fieldId} className={`${INPUT} ${SIZE[size]} ${className}`} {...rest}>
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

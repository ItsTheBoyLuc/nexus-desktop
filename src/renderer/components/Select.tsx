import { ChevronDown } from 'lucide-react'
import { useId } from 'react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  error?: string | null
  disabled?: boolean
  /** Visually hide the label (still announced by screen readers). */
  hideLabel?: boolean
  className?: string
}

/** Styled native <select>: full keyboard support and screen-reader semantics for free. */
export function Select({ label, value, options, onChange, placeholder, hint, error, disabled, hideLabel, className }: SelectProps) {
  const id = useId()
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label className={hideLabel ? 'sr-only' : 'field__label'} htmlFor={id}>
        {label}
      </label>
      <div className="select-wrap">
        <select
          id={id}
          className="control"
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="select-wrap__icon" size={16} aria-hidden="true" />
      </div>
      {error ? (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

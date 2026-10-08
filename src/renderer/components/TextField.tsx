import { useId } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface FieldCommon {
  label: string
  hint?: string
  /** Error message; also marks the control aria-invalid. */
  error?: string | null
  /** Shows "(optional)" after the label. */
  optional?: boolean
  /** Shows a live character counter against a maximum (counted after trimming, like the backend). */
  maxLength?: number
}

type InputFieldProps = FieldCommon & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'maxLength'>
type AreaFieldProps = FieldCommon & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'>
export type TextFieldProps = InputFieldProps | AreaFieldProps

export function TextField(props: TextFieldProps) {
  const { label, hint, error, optional, maxLength, multiline, className, ...rest } = props
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

  const value = typeof rest.value === 'string' ? rest.value : ''
  const used = value.trim().length
  const over = maxLength !== undefined && used > maxLength

  const controlProps = {
    id,
    className: ['control', className ?? ''].filter(Boolean).join(' '),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label} {optional ? <span className="field__optional">(optional)</span> : null}
      </label>
      {multiline ? (
        <textarea {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} {...controlProps} />
      ) : (
        <input {...(rest as InputHTMLAttributes<HTMLInputElement>)} {...controlProps} />
      )}
      <div className="field__row">
        <div>
          {error ? (
            <p className="field__error" id={errorId} role="alert">
              {error}
            </p>
          ) : hint ? (
            <p className="field__hint" id={hintId}>
              {hint}
            </p>
          ) : null}
        </div>
        {maxLength !== undefined ? (
          <span className={`field__counter${over ? ' field__counter--over' : ''}`} aria-hidden="true">
            {used}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  )
}

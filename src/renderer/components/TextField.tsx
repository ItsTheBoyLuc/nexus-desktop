import { useId } from 'react'
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { codePointLength, escapedLength } from '../../shared/validation'

interface FieldCommon {
  label: string
  hint?: string
  /** Error message; also marks the control aria-invalid. */
  error?: string | null
  /** Shows "(optional)" after the label. */
  optional?: boolean
  /** Shows a live character counter against a maximum (counted after trimming, in Unicode characters, like the backend). */
  maxLength?: number
  /** The docs mark this field with a star: the bot escapes the text, so each underscore counts as 2 (also in the counter). */
  escaped?: boolean
  /** Where the limit comes from (for example Discord), shown under the field next to the counter. */
  limitNote?: string
}

type InputFieldProps = FieldCommon & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'maxLength'>
type AreaFieldProps = FieldCommon & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'maxLength'>
export type TextFieldProps = InputFieldProps | AreaFieldProps

export function TextField(props: TextFieldProps) {
  const { label, hint, error, optional, maxLength, escaped, limitNote, multiline, className, ...rest } = props
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const noteId = `${id}-note`
  const describedBy = [hint ? hintId : '', error ? errorId : '', limitNote ? noteId : ''].filter(Boolean).join(' ') || undefined

  const value = typeof rest.value === 'string' ? rest.value : ''
  const trimmed = value.trim()
  const used = escaped ? escapedLength(trimmed) : codePointLength(trimmed)
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
            {used} / {maxLength}
          </span>
        ) : null}
      </div>
      {limitNote ? (
        <p className="field__hint field__limit-note" id={noteId}>
          {limitNote}
        </p>
      ) : null}
    </div>
  )
}

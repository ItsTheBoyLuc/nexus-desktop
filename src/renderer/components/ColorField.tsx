import { TextField } from './TextField'
import { isValidHexColor } from '../../shared/validation'

interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string | null
  disabled?: boolean
}

/** A colour as hex text (#RRGGBB) with a colour chooser and a swatch; the text is what gets sent. */
export function ColorField({ label, value, onChange, hint, error, disabled }: ColorFieldProps) {
  const valid = isValidHexColor(value.trim())
  return (
    <div className="field">
      <TextField
        label={label}
        value={value}
        maxLength={7}
        readOnly={disabled}
        hint={hint}
        error={error}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="color-row">
        <label className="color-pick">
          <input type="color" value={valid ? value.trim().toLowerCase() : '#808080'} disabled={disabled} aria-label={`Pick ${label.toLowerCase()} from a colour chooser`} onChange={(event) => onChange(event.target.value.toUpperCase())} />
          <span>Pick from a colour chooser</span>
        </label>
        <span className="swatch" style={{ background: valid ? value.trim() : 'transparent' }} role="img" aria-label={valid ? `Colour ${value.trim().toUpperCase()}` : 'No valid colour yet'} />
      </div>
    </div>
  )
}

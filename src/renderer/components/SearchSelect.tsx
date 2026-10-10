import { Check, ChevronDown } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { matchesQuery } from '../lib/tableView'

export interface SearchOption {
  value: string
  label: string
  /** Secondary line, searched too (e.g. why an option cannot be chosen). */
  description?: string
  disabled?: boolean
  /** Small marker shown at the end of the row. */
  badge?: string
  /** Decorative leading element (e.g. a colour dot). */
  leading?: ReactNode
}

interface SearchSelectProps {
  label: string
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  error?: string | null
  disabled?: boolean
  /** Text for an empty list (nothing loaded or nothing matches). */
  emptyText?: string
  /** Called with what the user types (and with "" when the list closes): lets a parent fetch matches from the server. */
  onQueryChange?: (query: string) => void
  /** False when the parent already filtered `options` (server-side search): they are all shown as they are. Default true. */
  filterLocally?: boolean
  /** A search is running: shown in the empty list. */
  loading?: boolean
}

/**
 * Searchable single-choice picker (ARIA combobox + listbox). Used wherever the user must pick a
 * Discord role or channel: they search by name and never type an ID. Keyboard: type to filter,
 * Up/Down to move, Enter to choose, Escape to close.
 */
export function SearchSelect({ label, value, options, onChange, placeholder = 'Search', hint, error, disabled, emptyText = 'Nothing found', onQueryChange, filterLocally = true, loading = false }: SearchSelectProps) {
  const id = useId()
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = options.find((option) => option.value === value)
  const visible = filterLocally ? options.filter((option) => matchesQuery([option.label, option.description], query)) : options
  const activeOption = visible[Math.min(active, Math.max(visible.length - 1, 0))]
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined

  const close = (): void => {
    setOpen(false)
    setQuery('')
    onQueryChange?.('')
  }
  const choose = (option: SearchOption | undefined): void => {
    if (!option || option.disabled) return
    onChange(option.value)
    close()
  }
  const move = (step: 1 | -1): void => {
    if (visible.length === 0) return
    let index = Math.min(active, visible.length - 1)
    for (let tries = 0; tries < visible.length; tries++) {
      index = (index + step + visible.length) % visible.length
      if (!visible[index]?.disabled) break
    }
    setActive(index)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) setOpen(true)
        else move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) setOpen(true)
        else move(-1)
        break
      case 'Enter':
        if (open) {
          event.preventDefault() // never submits the surrounding form while the list is open
          choose(activeOption)
        }
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          event.stopPropagation() // closes the list, not the dialog around it
          close()
        }
        break
      case 'Tab':
        close()
        break
    }
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="select-wrap">
        <input
          ref={inputRef}
          id={id}
          className="control"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeOption ? `${id}-opt-${activeOption.value}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={selected ? undefined : placeholder}
          value={open ? query : (selected?.label ?? '')}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={close}
          onChange={(event) => {
            setQuery(event.target.value)
            onQueryChange?.(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        <ChevronDown className="select-wrap__icon" size={16} aria-hidden="true" />
        {open ? (
          <ul id={listId} role="listbox" aria-label={label} className="search-list">
            {visible.length === 0 ? (
              <li className="search-list__empty">{loading ? 'Searching...' : options.length === 0 || !filterLocally ? emptyText : `No match for "${query}"`}</li>
            ) : null}
            {visible.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-opt-${option.value}`}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={`search-list__option${index === Math.min(active, visible.length - 1) ? ' is-active' : ''}${option.disabled ? ' is-disabled' : ''}`}
                // mousedown (not click): fires before the input loses focus, so the list is still there to be read
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(option)
                }}
                onMouseEnter={() => setActive(index)}
              >
                {option.leading}
                <span className="search-list__text">
                  <span className="search-list__label">{option.label}</span>
                  {option.description ? <span className="search-list__description">{option.description}</span> : null}
                </span>
                {option.badge ? <span className="search-list__badge">{option.badge}</span> : null}
                {option.value === value ? <Check size={16} aria-hidden="true" /> : null}
              </li>
            ))}
          </ul>
        ) : null}
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

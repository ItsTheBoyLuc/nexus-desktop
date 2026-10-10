import { X } from 'lucide-react'
import { useId } from 'react'
import { MemberPicker } from './MemberPicker'
import type { Person } from './MemberPicker'

interface MemberListPickerProps {
  label: string
  guildId: string
  /** The chosen user ids, in the order they were picked. */
  ids: readonly string[]
  /** The name to show for an id: a name the server sent, or the one of a person picked just now. */
  nameOf: (id: string) => string
  /** People offered without a search (the members already known on this screen). */
  known?: readonly Person[]
  max: number
  onAdd: (person: Person) => void
  onRemove: (id: string) => void
  hint?: string
  error?: string | null
  disabled?: boolean
}

/**
 * Several members chosen by name, never by ID: the chosen ones are listed with a remove button each, and a member search
 * adds the next one. Someone already in the list is shown as taken, so the same person cannot be added twice.
 */
export function MemberListPicker({ label, guildId, ids, nameOf, known, max, onAdd, onRemove, hint, error, disabled }: MemberListPickerProps) {
  const listId = useId()
  const full = ids.length >= max
  const taken = new Map(ids.map((id) => [id, 'Already in this list'] as [string, string]))

  return (
    <div className="member-list">
      <div className="section-head">
        <span className="field__label" id={`${listId}-label`}>
          {label}
        </span>
        <span className="muted" aria-live="polite">
          {ids.length} of {max}
        </span>
      </div>
      {ids.length === 0 ? (
        <p className="muted member-list__empty">Nobody yet.</p>
      ) : (
        <ul className="member-chips" aria-labelledby={`${listId}-label`}>
          {ids.map((id) => (
            <li key={id} className="member-chip">
              <span className="member-chip__name">{nameOf(id)}</span>
              <button type="button" className="member-chip__remove" disabled={disabled} aria-label={`Remove ${nameOf(id)} from ${label}`} onClick={() => onRemove(id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Keyed by how many are chosen, so the search box is empty again after every pick. */}
      <MemberPicker
        key={ids.length}
        label={`Add to ${label}`}
        guildId={guildId}
        value=""
        known={known}
        taken={taken}
        placeholder={full ? `The list is full (${max})` : 'Search by name'}
        disabled={disabled || full}
        hint={hint}
        error={error}
        onChange={(person) => {
          if (person) onAdd(person)
        }}
      />
    </div>
  )
}

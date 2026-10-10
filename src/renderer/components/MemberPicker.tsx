import { useEffect, useRef, useState } from 'react'
import { describeError, unwrap } from '../lib/errors'
import { matchesQuery } from '../lib/tableView'
import { SearchSelect } from './SearchSelect'
import type { SearchOption } from './SearchSelect'

export interface Person {
  id: string
  displayName: string
  username: string
}

interface MemberPickerProps {
  label: string
  guildId: string
  /** The chosen user id, or "" for nobody. */
  value: string
  onChange: (person: Person | null) => void
  /** People known without a search (a team roster, the standings): offered first and filtered on the spot. */
  known?: readonly Person[]
  /** User id -> why that person cannot be chosen (again). They are listed, but disabled. */
  taken?: ReadonlyMap<string, string>
  /** Adds a "None" entry that clears the choice. */
  allowNone?: boolean
  placeholder?: string
  hint?: string
  error?: string | null
  disabled?: boolean
}

const MIN_SEARCH = 2
const DEBOUNCE_MS = 300

/**
 * Pick a Discord member by name, never by ID. Known people (a roster) are filtered as you type; from 2 letters on the
 * server's member search (GET /members) is asked as well, with a short pause so typing does not use up the rate limit.
 * Late answers to an older search are ignored. Bots are not offered.
 */
export function MemberPicker({ label, guildId, value, onChange, known = [], taken, allowNone = false, placeholder = 'Search by name', hint, error, disabled }: MemberPickerProps) {
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<Person[]>([])
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' } | { kind: 'error'; text: string }>({ kind: 'idle' })
  const [chosen, setChosen] = useState<Person | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const text = query.trim()
    const id = ++requestId.current
    if ([...text].length < MIN_SEARCH) {
      // Nothing to ask: clear in a microtask-free way by deferring to the timer callback keeps the effect free of sync state updates.
      const reset = window.setTimeout(() => {
        if (requestId.current !== id) return
        setRemote([])
        setStatus({ kind: 'idle' })
      }, 0)
      return () => window.clearTimeout(reset)
    }
    const timer = window.setTimeout(() => {
      setStatus({ kind: 'loading' })
      unwrap(window.nexus.api.members(guildId, text)).then(
        (result) => {
          if (requestId.current !== id) return
          setRemote(result.members.filter((member) => !member.bot).map((member) => ({ id: member.id, displayName: member.displayName, username: member.username })))
          setStatus({ kind: 'idle' })
        },
        (failure: unknown) => {
          if (requestId.current !== id) return
          setRemote([])
          setStatus({ kind: 'error', text: describeError(failure) })
        }
      )
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, guildId])

  const byId = new Map<string, Person>()
  for (const person of known) if (matchesQuery([person.displayName, person.username], query)) byId.set(person.id, person)
  for (const person of remote) if (!byId.has(person.id)) byId.set(person.id, person)
  // The current choice always stays listed, so its name keeps showing while the list changes.
  const current = chosen?.id === value ? chosen : (known.find((person) => person.id === value) ?? null)
  if (current && !byId.has(current.id)) byId.set(current.id, current)

  const options: SearchOption[] = [
    ...(allowNone ? [{ value: '', label: 'None' }] : []),
    ...[...byId.values()].map((person): SearchOption => {
      const reason = taken?.get(person.id)
      return { value: person.id, label: person.displayName, description: reason ?? `@${person.username}`, disabled: reason !== undefined && person.id !== value }
    })
  ]

  const searching = [...query.trim()].length >= MIN_SEARCH
  const emptyText = !searching
    ? known.length > 0
      ? 'Type at least 2 letters to search the whole server.'
      : 'Type at least 2 letters to search for a member.'
    : status.kind === 'error'
      ? status.text
      : 'No member found. Check the spelling, or search by username.'

  return (
    <SearchSelect
      label={label}
      value={value}
      options={options}
      placeholder={placeholder}
      hint={hint}
      error={error}
      disabled={disabled}
      emptyText={emptyText}
      filterLocally={false}
      loading={status.kind === 'loading' && searching}
      onQueryChange={setQuery}
      onChange={(next) => {
        const person = next === '' ? null : (byId.get(next) ?? null)
        setChosen(person)
        onChange(person)
      }}
    />
  )
}
